// Financeiro Script (modelo Comanda Digital)

// Helper: formata valor como R$ 0,00 (vírgula decimal)
function formatarReal(valor) {
    return `R$ ${parseFloat(valor || 0).toFixed(2).replace('.', ',')}`;
}

// Helper: formata percentual como 0,0%
function formatarPct(valor) {
    return `${parseFloat(valor || 0).toFixed(1).replace('.', ',')}%`;
}

// Load page data
async function carregarDadosPagina() {
    await Promise.all([
        carregarKPIs(),
        carregarPagamentos(),
        carregarEstornos(),
        carregarResumoFinanceiro()
    ]);
}

// Fetch KPIs
async function carregarKPIs() {
    try {
        const res = await fetch('/api/relatorios/painel');
        if (!res.ok) throw new Error();
        const data = await res.json();

        document.getElementById('kpiRecebidoTotal').innerText = formatarReal(data.recebidoTotal);
        document.getElementById('kpiRecebidoHoje').innerText = formatarReal(data.recebidoHoje);
        document.getElementById('kpiEmAberto').innerText = formatarReal(data.totalEmAberto);
        document.getElementById('kpiClientes').innerText = data.totalClientes;
    } catch (err) {
        showToast('Erro ao carregar KPIs financeiros.', 'error');
    }
}

// Fetch Pagamentos List
async function carregarPagamentos() {
    const body = document.getElementById('pagamentosTableBody');
    if (!body) return;

    try {
        const res = await fetch('/api/pagamentos');
        if (!res.ok) throw new Error();
        const pagamentos = await res.json();

        body.innerHTML = '';
        if (pagamentos.length === 0) {
            body.innerHTML = `
                <tr>
                    <td colspan="5" class="table-empty">Nenhum pagamento registrado.</td>
                </tr>
            `;
            return;
        }

        pagamentos.forEach(p => {
            const tr = document.createElement('tr');
            const dataHora = new Date(p.criado_em).toLocaleString('pt-BR');
            const tipoLabel = p.tipo === 'segunda_via' ? '2ª via' : 'Comanda';
            tr.innerHTML = `
                <td><strong>${p.cliente_nome}</strong></td>
                <td style="color: var(--accent-green); font-weight: 600;">+ ${formatarReal(p.valor)}</td>
                <td><span class="badge-status" style="background: rgba(201, 168, 76, 0.1); color: var(--primary); border: 1px solid rgba(201,168,76,0.15);">${p.metodo}</span></td>
                <td>${tipoLabel}</td>
                <td>${dataHora}</td>
            `;
            body.appendChild(tr);
        });
    } catch (err) {
        body.innerHTML = `<tr><td colspan="5" class="table-empty" style="color: var(--primary-red);">Erro ao carregar pagamentos.</td></tr>`;
    }
}

// Fetch Estornos List
async function carregarEstornos() {
    const body = document.getElementById('estornosTableBody');
    if (!body) return;

    try {
        const res = await fetch('/api/estornos');
        if (!res.ok) throw new Error();
        const estornos = await res.json();

        body.innerHTML = '';
        if (estornos.length === 0) {
            body.innerHTML = `
                <tr>
                    <td colspan="5" class="table-empty">Nenhum estorno registrado.</td>
                </tr>
            `;
            return;
        }

        estornos.forEach(e => {
            const tr = document.createElement('tr');
            const dataHora = new Date(e.criado_em).toLocaleString('pt-BR');
            tr.innerHTML = `
                <td><strong>${e.cliente_nome}</strong></td>
                <td style="color: #AFA9EC; font-weight: 600;">${formatarReal(e.valor)}</td>
                <td>Torneira #${e.torneira_numero} (${e.chopp_nome})</td>
                <td style="max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${e.motivo}">${e.motivo}</td>
                <td>${dataHora}</td>
            `;
            body.appendChild(tr);
        });
    } catch (err) {
        body.innerHTML = `<tr><td colspan="5" class="table-empty" style="color: var(--primary-red);">Erro ao carregar estornos.</td></tr>`;
    }
}

// ==========================================
// Margem e Lucro (bruto) + markup global
// ==========================================
async function carregarResumoFinanceiro() {
    try {
        const res = await fetch('/api/financeiro/resumo');
        if (!res.ok) throw new Error();
        const d = await res.json();

        document.getElementById('mlReceitaComandas').innerText = formatarReal(d.receita_comandas);
        document.getElementById('mlCmv').innerText = formatarReal(d.cmv);
        document.getElementById('mlLucroBruto').innerText = formatarReal(d.lucro_bruto);
        document.getElementById('mlMargemPct').innerText = formatarPct(d.margem_pct);
        document.getElementById('mlInvestidoEstoque').innerText = formatarReal(d.investido_estoque);
    } catch (err) {
        showToast('Erro ao carregar margem e lucro.', 'error');
    }
}

// Busca o markup global e pré-preenche os campos
async function carregarMarkupGlobal() {
    try {
        const res = await fetch('/api/config/markup_padrao');
        if (!res.ok) throw new Error();
        const d = await res.json();
        const valor = d.valor !== null && d.valor !== undefined ? parseFloat(d.valor) : 0;

        const inputMarkup = document.getElementById('markupPadraoInput');
        const inputCalcMarkup = document.getElementById('calcMarkup');
        if (inputMarkup) inputMarkup.value = valor;
        // Só pré-preenche a calculadora se ainda estiver vazia
        if (inputCalcMarkup && inputCalcMarkup.value === '') inputCalcMarkup.value = valor;
        calcularPrecificacao();
    } catch (err) {
        showToast('Erro ao carregar markup padrão.', 'error');
    }
}

// Salva o markup global (PUT /api/config/markup_padrao)
async function salvarMarkupGlobal() {
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

// Carrega o valor da 2ª via do cartão (config valor_segunda_via)
async function carregarValorSegundaVia() {
    try {
        const res = await fetch('/api/config/valor_segunda_via');
        if (!res.ok) return;
        const d = await res.json();
        const input = document.getElementById('valorSegundaViaInput');
        if (input && d.valor != null) input.value = parseFloat(d.valor).toFixed(2);
    } catch (err) { /* silencioso */ }
}

// Salva o valor da 2ª via (PUT /api/config/valor_segunda_via)
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
// Calculadora de Precificação
// ==========================================
function calcularPrecificacao() {
    const custoBarril = parseFloat(document.getElementById('calcCustoBarril').value) || 0;
    const capacidade = parseFloat(document.getElementById('calcCapacidade').value) || 0;
    const markup = parseFloat(document.getElementById('calcMarkup').value) || 0;

    let preco300 = 0, preco500 = 0, preco1000 = 0, lucro300 = 0, lucro500 = 0, lucro1000 = 0, lucroBarril = 0;

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

        // Lucro estimado do barril cheio (vendido em copos de 300ml)
        const copos300 = (capacidade * 1000) / 300;
        lucroBarril = lucro300 * copos300;
    }

    document.getElementById('calcPreco300').innerText = formatarReal(preco300);
    document.getElementById('calcPreco500').innerText = formatarReal(preco500);
    document.getElementById('calcPreco1000').innerText = formatarReal(preco1000);
    document.getElementById('calcLucro300').innerText = formatarReal(lucro300);
    document.getElementById('calcLucro500').innerText = formatarReal(lucro500);
    document.getElementById('calcLucro1000').innerText = formatarReal(lucro1000);
    document.getElementById('calcLucroBarril').innerText = formatarReal(lucroBarril);
}

// Socket updates for financials
socket.on('relatorios_atualizado', () => {
    carregarDadosPagina();
});

socket.on('estornos_atualizado', () => {
    carregarDadosPagina();
});

socket.on('estoque_atualizado', () => {
    carregarResumoFinanceiro();
});

// Initialize Page
document.addEventListener('DOMContentLoaded', () => {
    carregarDadosPagina();
    carregarMarkupGlobal();
    carregarValorSegundaVia();

    document.getElementById('btnSalvarMarkup').addEventListener('click', salvarMarkupGlobal);
    const btnSegVia = document.getElementById('btnSalvarSegundaVia');
    if (btnSegVia) btnSegVia.addEventListener('click', salvarValorSegundaVia);

    ['calcCustoBarril', 'calcCapacidade', 'calcMarkup'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', calcularPrecificacao);
    });
});
