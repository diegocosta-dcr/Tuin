// Configurações (Administração)
// Markup padrão, valor da 2ª via e calculadora de preço de venda.
// socket e showToast vêm do /shared.js (NÃO redeclarar).

// Helper: formata valor como R$ 0,00 (vírgula decimal)
function formatarReal(valor) {
    return `R$ ${parseFloat(valor || 0).toFixed(2).replace('.', ',')}`;
}

// ==========================================
// Markup padrão (config markup_padrao)
// ==========================================

// GET preenche o campo de markup e a calculadora
async function carregarMarkupPadrao() {
    try {
        const res = await fetch('/api/config/markup_padrao');
        if (!res.ok) throw new Error();
        const d = await res.json();
        const valor = d.valor !== null && d.valor !== undefined ? parseFloat(d.valor) : 0;

        const inputMarkup = document.getElementById('markupPadraoInput');
        const inputCalcMarkup = document.getElementById('calcMarkup');
        if (inputMarkup) inputMarkup.value = valor;
        // Pré-preenche a calculadora com o markup global (se ainda vazia)
        if (inputCalcMarkup && inputCalcMarkup.value === '') inputCalcMarkup.value = valor;
        calcularPrecificacao();
    } catch (err) {
        showToast('Erro ao carregar markup padrão.', 'error');
    }
}

// PUT salva o markup padrão
async function salvarMarkupPadrao() {
    const inputMarkup = document.getElementById('markupPadraoInput');
    const valor = parseFloat(inputMarkup.value);
    if (isNaN(valor) || valor < 0) {
        showToast('Informe um markup válido (%).', 'error');
        return;
    }
    try {
        const res = await fetch('/api/config/markup_padrao', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ valor: String(valor) })
        });
        if (!res.ok) throw new Error();
        showToast('Markup padrão salvo.', 'success');
        // Reflete o novo markup na calculadora
        const inputCalcMarkup = document.getElementById('calcMarkup');
        if (inputCalcMarkup) inputCalcMarkup.value = valor;
        calcularPrecificacao();
    } catch (err) {
        showToast('Erro ao salvar markup padrão.', 'error');
    }
}

// ==========================================
// Valor da 2ª via do cartão (config valor_segunda_via)
// ==========================================

// GET preenche o campo da 2ª via
async function carregarValorSegundaVia() {
    try {
        const res = await fetch('/api/config/valor_segunda_via');
        if (!res.ok) return;
        const d = await res.json();
        const input = document.getElementById('valorSegundaViaInput');
        if (input && d.valor != null) input.value = parseFloat(d.valor).toFixed(2);
    } catch (err) { /* silencioso */ }
}

// PUT salva o valor da 2ª via
async function salvarValorSegundaVia() {
    const input = document.getElementById('valorSegundaViaInput');
    const valor = parseFloat(input.value);
    if (isNaN(valor) || valor < 0) {
        showToast('Informe um valor válido para a 2ª via.', 'error');
        return;
    }
    try {
        const res = await fetch('/api/config/valor_segunda_via', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ valor: valor.toFixed(2) })
        });
        if (!res.ok) throw new Error();
        showToast('Valor da 2ª via salvo.', 'success');
    } catch (err) {
        showToast('Erro ao salvar valor da 2ª via.', 'error');
    }
}

// ==========================================
// Calculadora de preço de venda
// custo_por_litro = custo_barril / capacidade_litros
// custo_copo = custo_por_litro * fator (0.3=300ml, 0.5=500ml, 1.0=growler)
// preco_sugerido = custo_copo * (1 + markup/100)
// lucro_copo = preco_sugerido - custo_copo
// lucro_barril = lucro_copo_500 * (capacidade_litros * 1000 / 500)
// ==========================================
function calcularPrecificacao() {
    const custoBarril = parseFloat(document.getElementById('calcCustoBarril').value) || 0;
    const capacidade = parseFloat(document.getElementById('calcCapacidade').value) || 0;
    const markup = parseFloat(document.getElementById('calcMarkup').value) || 0;

    let preco300 = 0, preco500 = 0, preco1000 = 0;
    let lucro300 = 0, lucro500 = 0, lucro1000 = 0, lucroBarril = 0;

    if (capacidade > 0) {
        const custoPorLitro = custoBarril / capacidade;
        const custoCopo300 = custoPorLitro * 0.3;
        const custoCopo500 = custoPorLitro * 0.5;
        const custoGrowler1000 = custoPorLitro * 1.0;
        const fator = 1 + (markup / 100);

        preco300 = custoCopo300 * fator;
        preco500 = custoCopo500 * fator;
        preco1000 = custoGrowler1000 * fator;
        lucro300 = preco300 - custoCopo300;
        lucro500 = preco500 - custoCopo500;
        lucro1000 = preco1000 - custoGrowler1000;

        // Lucro estimado do barril cheio (vendido em copos de 500ml)
        const copos500 = (capacidade * 1000) / 500;
        lucroBarril = lucro500 * copos500;
    }

    document.getElementById('calcPreco300').innerText = formatarReal(preco300);
    document.getElementById('calcPreco500').innerText = formatarReal(preco500);
    document.getElementById('calcPreco1000').innerText = formatarReal(preco1000);
    document.getElementById('calcLucro300').innerText = formatarReal(lucro300);
    document.getElementById('calcLucro500').innerText = formatarReal(lucro500);
    document.getElementById('calcLucro1000').innerText = formatarReal(lucro1000);
    document.getElementById('calcLucroBarril').innerText = formatarReal(lucroBarril);
}

// ==========================================
// Inicialização
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    carregarMarkupPadrao();
    carregarValorSegundaVia();

    const btnMarkup = document.getElementById('btnSalvarMarkup');
    if (btnMarkup) btnMarkup.addEventListener('click', salvarMarkupPadrao);

    const btnSegVia = document.getElementById('btnSalvarSegundaVia');
    if (btnSegVia) btnSegVia.addEventListener('click', salvarValorSegundaVia);

    ['calcCustoBarril', 'calcCapacidade', 'calcMarkup'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', calcularPrecificacao);
    });
});
