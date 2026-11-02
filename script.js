// ===== Configuração =====
const API = "https://economia.awesomeapi.com.br/json";
const INTERVALO_ATUALIZACAO = 60 * 1000; // 1 minuto

const MOEDAS = {
  USD: {
    nome: "Dólar americano",
    par: "USD-BRL",
    chave: "USDBRL",
    apelido: "dólar",
  },
  EUR: { nome: "Euro", par: "EUR-BRL", chave: "EURBRL", apelido: "euro" },
  BTC: { nome: "Bitcoin", par: "BTC-BRL", chave: "BTCBRL", apelido: "bitcoin" },
};

// ===== Estado =====
const estado = {
  cotacoes: {}, // { USD: { valor, variacao, max, min, desatualizada }, ... }
  moedaGrafico: "USD",
  dias: 30,
  grafico: null,
  // Números de ordem das consultas. Só a mais recente pode atualizar a tela.
  idCotacoes: 0,
  idHistorico: 0,
};

// ===== Elementos =====
const el = {
  atualizacao: document.getElementById("atualizacao"),
  btnAtualizar: document.getElementById("btn-atualizar"),
  lista: document.getElementById("lista"),
  erroCotacoes: document.getElementById("erro-cotacoes"),
  resumo: document.getElementById("resumo-grafico"),
  periodos: document.querySelectorAll(".periodo"),
  valor: document.getElementById("valor"),
  de: document.getElementById("de"),
  para: document.getElementById("para"),
  inverter: document.getElementById("inverter"),
  resultado: document.getElementById("resultado"),
  form: document.getElementById("form-conversor"),
};

// ===== Formatação =====
const brl = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

function formatarMoeda(numero, moeda) {
  if (moeda === "BTC") {
    return (
      numero.toLocaleString("pt-BR", { maximumFractionDigits: 8 }) + " BTC"
    );
  }
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: moeda,
  }).format(numero);
}

function formatarPercentual(numero) {
  const sinal = numero > 0 ? "+" : "";
  return (
    sinal + numero.toLocaleString("pt-BR", { maximumFractionDigits: 2 }) + "%"
  );
}

function horaAgora() {
  return new Date().toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Diferencia a hora da consulta da hora da cotação, porque a API pode devolver dado em cache.
function textoAtualizacao() {
  const horas = Object.values(estado.cotacoes)
    .filter((c) => !c.desatualizada && c.horaCotacao)
    .map((c) => c.horaCotacao)
    .sort();
  const consulta = "Consultado às " + horaAgora() + ".";
  return horas.length
    ? `${consulta} Cotação mais antiga: ${horas[0]}.`
    : consulta;
}

// ===== Validação =====
// Preço precisa ser número finito e maior que zero.
function precoValido(numero) {
  return Number.isFinite(numero) && numero > 0;
}

// Transforma o item da API em uma cotação segura, ou devolve null se algo estiver errado.
function lerCotacao(item) {
  if (!item || typeof item !== "object") return null;

  const valor = Number(item.bid);
  const variacao = Number(item.pctChange);
  const max = Number(item.high);
  const min = Number(item.low);

  if (!precoValido(valor) || !precoValido(max) || !precoValido(min))
    return null;
  if (!Number.isFinite(variacao)) return null;

  // Hora da cotação segundo a API (campo create_date), para mostrar a idade real do dado.
  const achou = /(\d{2}:\d{2})/.exec(String(item.create_date || ""));
  const horaCotacao = achou ? achou[1] : null;

  return { valor, variacao, max, min, horaCotacao, desatualizada: false };
}

// ===== Rede =====
// Busca com tempo limite, para o site não ficar esperando para sempre.
async function buscarJSON(url, tempoLimite = 10000) {
  const controle = new AbortController();
  const timer = setTimeout(() => controle.abort(), tempoLimite);
  try {
    const resposta = await fetch(url, { signal: controle.signal });
    if (!resposta.ok) {
      throw new Error("A API respondeu com status " + resposta.status);
    }
    return await resposta.json();
  } finally {
    clearTimeout(timer);
  }
}

// ===== Cotações atuais =====
function mostrarErroCotacoes(mensagem) {
  el.erroCotacoes.textContent = mensagem;
  el.erroCotacoes.hidden = false;
}

function marcarTodasDesatualizadas() {
  for (const cotacao of Object.values(estado.cotacoes)) {
    cotacao.desatualizada = true;
  }
}

async function carregarCotacoes() {
  const id = ++estado.idCotacoes;
  el.btnAtualizar.disabled = true;
  el.erroCotacoes.hidden = true;

  try {
    const pares = Object.values(MOEDAS)
      .map((m) => m.par)
      .join(",");
    const dados = await buscarJSON(`${API}/last/${pares}`);

    // Chegou uma consulta mais nova enquanto esta esperava: descarta esta.
    if (id !== estado.idCotacoes) return;

    const semDados = [];
    for (const [sigla, moeda] of Object.entries(MOEDAS)) {
      const nova = lerCotacao(dados && dados[moeda.chave]);
      if (nova) {
        estado.cotacoes[sigla] = nova;
      } else {
        semDados.push(moeda.nome);
        // Mantém o valor antigo, mas marcado, para a tela avisar.
        if (estado.cotacoes[sigla]) estado.cotacoes[sigla].desatualizada = true;
      }
    }

    if (semDados.length === Object.keys(MOEDAS).length) {
      throw new Error("Nenhuma cotação válida na resposta");
    }

    renderizarLista();
    converter();

    if (semDados.length > 0) {
      el.atualizacao.textContent = "Atualização parcial. " + textoAtualizacao();
      mostrarErroCotacoes(
        "Sem dados novos para: " +
          semDados.join(", ") +
          ". Os valores dessas moedas podem estar desatualizados.",
      );
    } else {
      el.atualizacao.textContent = textoAtualizacao();
    }
  } catch (erro) {
    if (id !== estado.idCotacoes) return;
    console.error(erro);
    marcarTodasDesatualizadas();
    renderizarLista();
    converter();
    mostrarErroCotacoes(
      "Não foi possível carregar as cotações. Verifique sua conexão e tente de novo.",
    );
    el.atualizacao.textContent = "Falha na atualização";
  } finally {
    // Só a consulta mais recente libera o botão.
    if (id === estado.idCotacoes) el.btnAtualizar.disabled = false;
  }
}

function renderizarLista() {
  el.lista.replaceChildren();

  for (const [sigla, moeda] of Object.entries(MOEDAS)) {
    const c = estado.cotacoes[sigla];
    if (!c) continue;

    const item = document.createElement("li");
    const botao = document.createElement("button");
    botao.type = "button";
    botao.className = "moeda";
    botao.dataset.sigla = sigla;
    botao.setAttribute("aria-pressed", String(sigla === estado.moedaGrafico));

    const nome = document.createElement("span");
    nome.className = "moeda-nome";
    nome.textContent = moeda.nome + " ";
    const siglaEl = document.createElement("span");
    siglaEl.className = "moeda-sigla";
    siglaEl.textContent = sigla;
    nome.appendChild(siglaEl);

    const valor = document.createElement("span");
    valor.className = "moeda-valor";
    valor.textContent = brl.format(c.valor);

    const faixa = document.createElement("span");
    faixa.className = "moeda-faixa";
    faixa.textContent = `Mín ${brl.format(c.min)} / Máx ${brl.format(c.max)}`;

    const variacao = document.createElement("span");
    const subiu = c.variacao >= 0;
    variacao.className = "moeda-var " + (subiu ? "sobe" : "desce");
    variacao.textContent =
      (subiu ? "▲ " : "▼ ") + formatarPercentual(c.variacao);

    botao.append(nome, valor, faixa, variacao);

    if (c.desatualizada) {
      const aviso = document.createElement("span");
      aviso.className = "moeda-aviso";
      aviso.textContent =
        "Valor desatualizado: a última consulta não trouxe dados novos.";
      botao.appendChild(aviso);
    }

    item.appendChild(botao);
    el.lista.appendChild(item);
  }
}

// ===== Gráfico =====
function limparGrafico() {
  if (!estado.grafico) return;
  estado.grafico.destroy();
  estado.grafico = null;
}

async function carregarHistorico() {
  const id = ++estado.idHistorico;
  // Guarda a escolha desta consulta, porque o estado pode mudar enquanto ela espera.
  const moeda = MOEDAS[estado.moedaGrafico];
  const dias = estado.dias;
  limparGrafico();
  el.resumo.textContent = "Carregando histórico...";

  try {
    const dados = await buscarJSON(`${API}/daily/${moeda.par}/${dias}`);

    // Se o usuário trocou de moeda ou período nesse meio tempo, esta resposta é velha.
    if (id !== estado.idHistorico) return;

    if (!Array.isArray(dados)) {
      throw new Error("Resposta do histórico em formato inesperado");
    }

    // A API devolve do dia mais recente para o mais antigo, então invertemos.
    // Pontos com data ou valor inválidos são descartados.
    const pontos = dados
      .map((d) => ({
        data: new Date(Number(d && d.timestamp) * 1000),
        valor: Number(d && d.bid),
      }))
      .filter((p) => Number.isFinite(p.data.getTime()) && precoValido(p.valor))
      .reverse();

    if (pontos.length < 2) {
      limparGrafico();
      el.resumo.textContent =
        "Não há dados válidos suficientes para montar o gráfico.";
      return;
    }

    if (!desenharGrafico(pontos, moeda)) {
      return;
    }

    const primeiro = pontos[0].valor;
    const ultimo = pontos[pontos.length - 1].valor;
    const variacao = ((ultimo - primeiro) / primeiro) * 100;
    el.resumo.textContent =
      `Nos últimos ${dias} dias, o ${moeda.apelido} foi de ${brl.format(primeiro)} ` +
      `para ${brl.format(ultimo)} (${formatarPercentual(variacao)}).`;
  } catch (erro) {
    if (id !== estado.idHistorico) return;
    console.error(erro);
    limparGrafico();
    el.resumo.textContent =
      "Não foi possível carregar o histórico. Tente outro período ou atualize a página.";
  }
}

function desenharGrafico(pontos, moeda) {
  if (typeof Chart === "undefined") {
    el.resumo.textContent =
      "A biblioteca do gráfico não carregou. Verifique sua conexão.";
    return false;
  }

  const rotulos = pontos.map((p) =>
    p.data.toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
    }),
  );

  const valores = pontos.map((p) => p.valor);

  if (estado.grafico) {
    estado.grafico.data.labels = rotulos;
    estado.grafico.data.datasets[0].data = valores;
    estado.grafico.data.datasets[0].label = moeda.nome;
    estado.grafico.update();
    return true;
  }

  const canvas = document.getElementById("grafico");

  if (!canvas) {
    return false;
  }

  const ctx = canvas.getContext("2d");

  estado.grafico = new Chart(ctx, {
    type: "line",
    data: {
      labels: rotulos,
      datasets: [
        {
          label: moeda.nome,
          data: valores,
          borderColor: "#1f5fd1",
          backgroundColor: "rgba(31, 95, 209, 0.12)",
          borderWidth: 2.5,
          pointRadius: 0,
          pointHoverRadius: 5,
          tension: 0.25,
          fill: true,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: "index",
        intersect: false,
      },
      plugins: {
        legend: {
          display: false,
        },
        tooltip: {
          callbacks: {
            label: (item) => " " + brl.format(item.parsed.y),
          },
        },
      },
      scales: {
        x: {
          ticks: {
            maxTicksLimit: 6,
          },
          grid: {
            display: false,
          },
        },
        y: {
          ticks: {
            callback: (v) => brl.format(v),
          },
        },
      },
    },
  });

  return true;
}

// ===== Conversor =====
function taxaEmReais(sigla) {
  if (sigla === "BRL") return 1;
  return estado.cotacoes[sigla]?.valor;
}

function converter() {
  const quantidade = parseFloat(el.valor.value);
  const de = el.de.value;
  const para = el.para.value;

  if (!Number.isFinite(quantidade) || quantidade < 0) {
    el.resultado.textContent = "Digite um valor válido.";
    return;
  }

  const taxaDe = taxaEmReais(de);
  const taxaPara = taxaEmReais(para);
  if (!taxaDe || !taxaPara) {
    el.resultado.textContent = "Aguardando cotações...";
    return;
  }

  // Passa tudo para reais e depois para a moeda de destino.
  const resultado = (quantidade * taxaDe) / taxaPara;
  let texto = `${formatarMoeda(quantidade, de)} = ${formatarMoeda(resultado, para)}`;

  // Avisa quando alguma das cotações usadas está velha.
  const velha = [de, para].some(
    (s) => s !== "BRL" && estado.cotacoes[s]?.desatualizada,
  );
  if (velha) texto += " (cotação desatualizada)";

  el.resultado.textContent = texto;
}

// ===== Eventos =====
el.btnAtualizar.addEventListener("click", () => {
  carregarCotacoes();
  carregarHistorico();
});

// Um único listener na lista, em vez de um por botão (delegação de eventos).
el.lista.addEventListener("click", (evento) => {
  const botao = evento.target.closest(".moeda");
  if (!botao) return;
  estado.moedaGrafico = botao.dataset.sigla;
  renderizarLista();
  carregarHistorico();
});

el.periodos.forEach((botao) => {
  botao.addEventListener("click", () => {
    estado.dias = Number(botao.dataset.dias);
    el.periodos.forEach((b) =>
      b.setAttribute("aria-pressed", String(b === botao)),
    );
    carregarHistorico();
  });
});

el.form.addEventListener("submit", (e) => e.preventDefault());
el.form.addEventListener("input", converter);

el.inverter.addEventListener("click", () => {
  [el.de.value, el.para.value] = [el.para.value, el.de.value];
  converter();
});

// ===== Início =====
carregarCotacoes();
carregarHistorico();
setInterval(carregarCotacoes, INTERVALO_ATUALIZACAO);
