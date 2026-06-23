// ============================================================
// Estoque de Barris — shared.js já fornece socket e showToast.
// ============================================================

let barris = [];
let torneiras = [];
let barrilParaMontar = null;
let markupPadrao = 0;

function brl(v) { return 'R$ ' + (Number(v) || 0).toFixed(2).replace('.', ','); }
function litros(ml) { return (Number(ml) || 0) / 1000; }
function fmtL(ml) { return litros(ml).toFixed(1).replace('.', ',') + ' L'; }
function esc(t) {
    return String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function dataBR(s) {
    if (!s) return '-';
    try { return new Date(String(s).replace(' ', 'T') + 'Z').toLocaleDateString('pt-BR'); }
    catch (e) { return s; }
}

async function carregarTudo() {
    await Promise.all([carregarBarris(), carregarResumo(), carregarTorneiras(), carregarMarkup()]);
    carregarChopps();
    carregarMarcas();
}

async function carregarBarris() {
    try {
        const res = await fetch('/api/barris');
        barris = res.ok ? await res.json() : [];
        renderizar();
    } catch (e) { console.error(e); }
}

async function carregarResumo() {
    try {
        const res = await fetch('/api/estoque/resumo');
        if (!res.ok) return;
        const r = await res.json();
        document.getElementById('kpiBarris').textContent = r.barris_disponiveis;
        document.getElementById('kpiVolume').textContent = fmtL(r.volume_disponivel_ml);
        document.getElementById('kpiValor').textContent = brl(r.valor_estoque);
        document.getElementById('kpiEmUso').textContent = r.barris_em_uso;
    } catch (e) { console.error(e); }
}

// Popula o datalist com os nomes DISTINTOS de chopp dos barris já cadastrados.
function carregarChopps() {
    const dl = document.getElementById('choppSugestoes');
    if (!dl) return;
    const nomes = [...new Set(
        barris.map(b => (b.chopp_nome || '').trim()).filter(Boolean)
    )].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    dl.innerHTML = nomes.map(n => `<option value="${esc(n)}"></option>`).join('');
}

// Popula o datalist com as marcas/fornecedores DISTINTOS dos barris já cadastrados.
function carregarMarcas() {
    const dl = document.getElementById('marcaSugestoes');
    if (!dl) return;
    const marcas = [...new Set(
        barris.map(b => (b.marca || '').trim()).filter(Boolean)
    )].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    dl.innerHTML = marcas.map(m => `<option value="${esc(m)}"></option>`).join('');
}

// Lê o markup global (config 'markup_padrao', em %) usado só como calculadora.
async function carregarMarkup() {
    try {
        const res = await fetch('/api/config/markup_padrao');
        if (!res.ok) return;
        const d = await res.json();
        markupPadrao = parseFloat(d.valor) || 0;
    } catch (e) { console.error(e); }
}

async function carregarTorneiras() {
    try {
        const res = await fetch('/api/torneiras');
        torneiras = res.ok ? await res.json() : [];
    } catch (e) { console.error(e); }
}

// Selo discreto de marca/fornecedor (vazio se não houver marca).
function seloMarca(b) {
    const marca = (b.marca || '').trim();
    if (!marca) return '';
    return `<div class="barril-marca">Fornecedor: ${esc(marca)}</div>`;
}

// Barra de progresso de volume restante
function barraVolume(b) {
    const restante = b.volume_restante_ml;
    const pct = b.capacidade_ml > 0 ? Math.max(0, Math.min(100, (restante / b.capacidade_ml) * 100)) : 0;
    let cor = 'var(--success)';
    if (pct <= 0) cor = 'var(--error)';
    else if (pct <= 15) cor = 'var(--warn)';
    return `
        <div class="vol-bar"><div class="vol-fill" style="width:${pct}%; background:${cor};"></div></div>
        <div class="vol-txt">
            <span>${fmtL(restante)} de ${fmtL(b.capacidade_ml)}</span>
            <span>${pct.toFixed(0)}%</span>
        </div>`;
}

function renderizar() {
    const emUso = barris.filter(b => b.status === 'em_uso');
    const estoque = barris.filter(b => b.status === 'estoque');
    const vazios = barris.filter(b => b.status === 'vazio');

    // Em uso
    const gridUso = document.getElementById('barrisEmUso');
    if (emUso.length === 0) {
        gridUso.innerHTML = '<div class="lista-vazia">Nenhum barril montado nas torneiras.</div>';
    } else {
        gridUso.innerHTML = emUso.map(b => `
            <div class="barril-card em-uso">
                <div class="barril-top">
                    <span class="barril-torneira">Torneira ${esc(b.torneira_numero ?? '?')}</span>
                    <span class="barril-chopp">${esc(b.chopp_nome)}</span>
                </div>
                ${seloMarca(b)}
                ${barraVolume(b)}
                <div class="barril-acoes">
                    <button class="btn btn-secondary btn-sm" onclick="trocarBarril(${b.id})"><i class="fa-solid fa-right-left"></i> Trocar/Desmontar</button>
                    <button class="btn btn-sm btn-vazio" onclick="marcarVazio(${b.id}, '${esc(b.chopp_nome)}')"><i class="fa-solid fa-circle-xmark"></i> Marcar vazio</button>
                </div>
            </div>
        `).join('');
    }

    // Em estoque
    const gridEst = document.getElementById('barrisEstoque');
    if (estoque.length === 0) {
        gridEst.innerHTML = '<div class="lista-vazia">Nenhum barril parado no estoque.</div>';
    } else {
        gridEst.innerHTML = estoque.map(b => `
            <div class="barril-card">
                <div class="barril-top">
                    <span class="barril-chopp">${esc(b.chopp_nome)}</span>
                    <span class="barril-custo">${brl(b.preco_custo)}</span>
                </div>
                ${seloMarca(b)}
                ${barraVolume(b)}
                <div class="barril-acoes">
                    <button class="btn btn-primary btn-sm" onclick="abrirMontar(${b.id})"><i class="fa-solid fa-link"></i> Montar na torneira</button>
                    <button class="btn btn-sm btn-del-barril" onclick="excluirBarril(${b.id}, '${esc(b.chopp_nome)}')" title="Excluir"><i class="fa-solid fa-trash"></i></button>
                </div>
            </div>
        `).join('');
    }

    // Vazios (relatório de perda)
    const tbody = document.getElementById('barrisVaziosBody');
    if (vazios.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="table-empty">Nenhum barril finalizado ainda.</td></tr>';
    } else {
        tbody.innerHTML = vazios.map(b => {
            const perda = b.capacidade_ml - b.volume_vendido_ml;
            const pct = b.capacidade_ml > 0 ? (perda / b.capacidade_ml * 100) : 0;
            const corPct = pct > 15 ? 'var(--error)' : pct > 8 ? 'var(--warn)' : 'var(--success)';
            return `<tr>
                <td><strong>${esc(b.chopp_nome)}</strong></td>
                <td>${b.marca ? esc(b.marca) : '<span style="opacity:0.5;">—</span>'}</td>
                <td>${fmtL(b.capacidade_ml)}</td>
                <td style="color:var(--success);">${fmtL(b.volume_vendido_ml)}</td>
                <td>${fmtL(perda)}</td>
                <td style="color:${corPct}; font-weight:700;">${pct.toFixed(1)}%</td>
                <td>${brl(b.preco_custo)}</td>
                <td style="font-size:0.75rem;">${dataBR(b.esvaziado_em)}</td>
            </tr>`;
        }).join('');
    }
}

// ── Entrada ──
function abrirEntrada() {
    document.getElementById('modalEntrada').classList.add('active');
    carregarChopps();
    atualizarSugestaoPreco();
}
function fecharEntrada() {
    document.getElementById('modalEntrada').classList.remove('active');
    document.getElementById('formEntrada').reset();
    atualizarSugestaoPreco();
}

// Sugestão de preço ao vivo (calculadora; não altera preços automaticamente).
function atualizarSugestaoPreco() {
    const box = document.getElementById('sugestaoPreco');
    if (!box) return;
    const capacidade = parseFloat(document.getElementById('entradaCapacidade').value);
    const custo = parseFloat(document.getElementById('entradaPreco').value);
    if (!capacidade || capacidade <= 0 || !custo || custo <= 0) {
        box.style.display = 'none';
        return;
    }
    const custoPorLitro = custo / capacidade;
    const custo300 = custoPorLitro * 0.3;
    const custo500 = custoPorLitro * 0.5;
    const custo1000 = custoPorLitro * 1.0;
    const fator = 1 + (markupPadrao / 100);
    const sug300 = custo300 * fator;
    const sug500 = custo500 * fator;
    const sug1000 = custo1000 * fator;

    document.getElementById('sugMarkup').textContent = `(markup ${markupPadrao.toLocaleString('pt-BR')}%)`;
    document.getElementById('sug300').textContent = brl(sug300);
    document.getElementById('sug500').textContent = brl(sug500);
    document.getElementById('sug1000').textContent = brl(sug1000);
    document.getElementById('sugLucro300').textContent = brl(sug300 - custo300);
    document.getElementById('sugLucro500').textContent = brl(sug500 - custo500);
    document.getElementById('sugLucro1000').textContent = brl(sug1000 - custo1000);
    box.style.display = '';
}

async function submeterEntrada(e) {
    e.preventDefault();
    const chopp_nome = document.getElementById('entradaChopp').value.trim();
    const estilo = document.getElementById('entradaEstilo').value.trim();
    const marca = document.getElementById('entradaMarca').value.trim();
    const capacidade_litros = parseFloat(document.getElementById('entradaCapacidade').value);
    const preco_custo = parseFloat(document.getElementById('entradaPreco').value) || 0;
    if (!chopp_nome || !capacidade_litros) { showToast('Preencha chopp e capacidade.', 'error'); return; }
    try {
        const res = await fetch('/api/barris', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chopp_nome, estilo, marca, capacidade_litros, preco_custo })
        });
        const d = await res.json();
        if (!res.ok) throw new Error(d.error || 'Erro');
        showToast('Barril adicionado ao estoque!', 'success');
        fecharEntrada();
        carregarTudo();
    } catch (err) { showToast(err.message, 'error'); }
}

// ── Montar ──
function abrirMontar(barrilId) {
    barrilParaMontar = barrilId;
    const b = barris.find(x => x.id === barrilId);
    document.getElementById('montarInfo').innerHTML = b
        ? `Barril de <strong>${esc(b.chopp_nome)}</strong> — ${fmtL(b.volume_restante_ml)} restantes.`
        : '';
    const sel = document.getElementById('montarTorneira');
    sel.innerHTML = torneiras
        .filter(t => t.chopp_nome !== 'Torneira Livre' || true)
        .map(t => {
            const ocup = t.barril_id ? ' (ocupada — será trocada)' : '';
            return `<option value="${t.id}">Torneira ${t.numero}${ocup}</option>`;
        }).join('');
    document.getElementById('modalMontar').classList.add('active');
}
function fecharMontar() { document.getElementById('modalMontar').classList.remove('active'); barrilParaMontar = null; }

async function confirmarMontar() {
    if (!barrilParaMontar) return;
    const torneira_id = document.getElementById('montarTorneira').value;
    if (!torneira_id) { showToast('Selecione a torneira.', 'error'); return; }
    try {
        const res = await fetch(`/api/barris/${barrilParaMontar}/montar`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ torneira_id })
        });
        const d = await res.json();
        if (!res.ok) throw new Error(d.error || 'Erro');
        showToast(d.message || 'Barril montado!', 'success');
        fecharMontar();
        carregarTudo();
    } catch (err) { showToast(err.message, 'error'); }
}

// ── Trocar/Desmontar ──
async function trocarBarril(barrilId) {
    if (!confirm('Desmontar este barril da torneira? Ele volta ao estoque com o volume restante.')) return;
    try {
        const res = await fetch(`/api/barris/${barrilId}/desmontar`, { method: 'POST' });
        const d = await res.json();
        if (!res.ok) throw new Error(d.error || 'Erro');
        showToast(d.message, 'success');
        carregarTudo();
    } catch (err) { showToast(err.message, 'error'); }
}

// ── Marcar vazio ──
async function marcarVazio(barrilId, nome) {
    if (!confirm(`Marcar o barril de ${nome} como VAZIO? Isso encerra o barril e calcula a perda.`)) return;
    try {
        const res = await fetch(`/api/barris/${barrilId}/vazio`, { method: 'POST' });
        const d = await res.json();
        if (!res.ok) throw new Error(d.error || 'Erro');
        showToast(`Barril finalizado. Vendido ${d.vendido_litros} L · perda ${d.perda_litros} L (${d.perda_pct}%).`, 'success');
        carregarTudo();
    } catch (err) { showToast(err.message, 'error'); }
}

// ── Excluir ──
async function excluirBarril(barrilId, nome) {
    if (!confirm(`Excluir o barril de ${nome} do estoque?`)) return;
    try {
        const res = await fetch(`/api/barris/${barrilId}`, { method: 'DELETE' });
        const d = await res.json();
        if (!res.ok) throw new Error(d.error || 'Erro');
        showToast('Barril removido.', 'success');
        carregarTudo();
    } catch (err) { showToast(err.message, 'error'); }
}

// ── Init ──
document.addEventListener('DOMContentLoaded', () => {
    carregarTudo();

    document.getElementById('btnEntradaBarril').addEventListener('click', abrirEntrada);
    document.getElementById('btnFecharEntrada').addEventListener('click', fecharEntrada);
    document.getElementById('btnCancelarEntrada').addEventListener('click', fecharEntrada);
    document.getElementById('formEntrada').addEventListener('submit', submeterEntrada);
    document.getElementById('entradaCapacidade').addEventListener('input', atualizarSugestaoPreco);
    document.getElementById('entradaPreco').addEventListener('input', atualizarSugestaoPreco);

    document.getElementById('btnFecharMontar').addEventListener('click', fecharMontar);
    document.getElementById('btnCancelarMontar').addEventListener('click', fecharMontar);
    document.getElementById('btnConfirmarMontar').addEventListener('click', confirmarMontar);

    socket.on('estoque_atualizado', carregarTudo);
    socket.on('torneiras_atualizado', carregarTudo);
});
