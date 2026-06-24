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
});
