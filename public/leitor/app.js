// ============================================================
// Leitor NFC — Ambiente de Testes
// shared.js já declara socket e showToast. Não redeclarar.
// ============================================================

let cartoes = [];
let clientes = [];
let torneirasAtivas = [];

function escaparHtml(txt) {
    return String(txt ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ── Carregar dados ──
async function carregarTudo() {
    await Promise.all([carregarCartoes(), carregarClientes(), carregarTorneiras()]);
}

async function carregarCartoes() {
    try {
        const res = await fetch('/api/cartoes');
        cartoes = res.ok ? await res.json() : [];
        renderizarCartoes();
    } catch (err) {
        console.error(err);
    }
}

async function carregarClientes() {
    try {
        const res = await fetch('/api/clientes');
        clientes = res.ok ? await res.json() : [];
        const sel = document.getElementById('selectClienteTeste');
        sel.innerHTML = '<option value="">Selecione um cliente...</option>' +
            clientes.map(c => `<option value="${c.id}">${escaparHtml(c.nome)}</option>`).join('');
    } catch (err) {
        console.error(err);
    }
}

async function carregarTorneiras() {
    try {
        const res = await fetch('/api/torneiras');
        const todas = res.ok ? await res.json() : [];
        torneirasAtivas = todas.filter(t => t.status === 'ativa' && (t.preco_copo_300 > 0 || t.preco_copo_500 > 0));
    } catch (err) {
        console.error(err);
    }
}

function renderizarCartoes() {
    const grid = document.getElementById('cartoesGrid');
    const comCartao = cartoes.filter(c => c.uid && c.cliente_id);
    if (comCartao.length === 0) {
        grid.innerHTML = '<div class="lista-vazia">Nenhum cartão vinculado. Cadastre clientes e vincule cartões.</div>';
        return;
    }
    grid.innerHTML = '';
    comCartao.forEach(c => {
        const div = document.createElement('div');
        div.className = 'cartao-nfc';
        div.innerHTML = `
            <div class="cartao-chip"><i class="fa-solid fa-microchip"></i></div>
            <div class="cartao-info">
                <span class="cartao-nome">${escaparHtml(c.cliente_nome || 'Cliente')}</span>
                <span class="cartao-uid">${escaparHtml(c.uid)}</span>
            </div>
            <i class="fa-solid fa-hand-pointer cartao-acao"></i>
        `;
        div.addEventListener('click', () => encostarCartao(c.uid, c.cliente_nome));
        grid.appendChild(div);
    });
}

// ── Encostar cartão (emite nfc_lido para as outras telas) ──
function encostarCartao(uid, nome) {
    if (!uid) { showToast('Informe um UID.', 'error'); return; }
    socket.emit('nfc_lido', { uid });

    const reader = document.getElementById('leitorReader');
    const readerText = document.getElementById('readerText');
    reader.classList.add('lendo');
    readerText.textContent = `Cartão de ${nome || uid} enviado!`;
    showToast(`Cartão de ${nome || uid} aproximado. Veja na tela de Atendimento.`, 'success');

    setTimeout(() => {
        reader.classList.remove('lendo');
        readerText.textContent = 'Aguardando cartão...';
    }, 1800);
}

// ── Ferramentas de teste ──
async function lancarConsumoTeste() {
    const clienteId = document.getElementById('selectClienteTeste').value;
    if (!clienteId) { showToast('Selecione um cliente.', 'error'); return; }
    if (torneirasAtivas.length === 0) { showToast('Nenhuma torneira ativa com preço configurado.', 'error'); return; }

    const t = torneirasAtivas[0];
    const tamanho = t.preco_copo_300 > 0 ? 300 : 500;
    try {
        const res = await fetch('/api/consumos', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cliente_id: clienteId, torneira_id: t.id, tamanho_ml: tamanho })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Erro ao lançar consumo');
        showToast(`Consumo de teste lançado (${t.chopp_nome}, ${tamanho}ml).`, 'success');
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function envelhecerComanda(horas) {
    const clienteId = document.getElementById('selectClienteTeste').value;
    if (!clienteId) { showToast('Selecione um cliente.', 'error'); return; }
    try {
        const res = await fetch('/api/teste/envelhecer-comanda', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cliente_id: clienteId, horas })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Erro ao envelhecer comanda');
        const txt = horas === 0 ? 'Comanda voltou ao tempo normal.'
            : `Comanda marcada como aberta há ${horas}h. Veja a cor no Caixa/Atendimento.`;
        showToast(txt, 'success');
    } catch (err) {
        showToast(err.message, 'error');
    }
}

// ── Inicialização ──
document.addEventListener('DOMContentLoaded', () => {
    carregarTudo();

    document.getElementById('btnUidManual').addEventListener('click', () => {
        const uid = document.getElementById('uidManual').value.trim();
        encostarCartao(uid, null);
    });
    document.getElementById('uidManual').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') document.getElementById('btnUidManual').click();
    });

    document.getElementById('btnComandaTeste').addEventListener('click', lancarConsumoTeste);
    document.getElementById('btnEnvelhecer13').addEventListener('click', () => envelhecerComanda(13));
    document.getElementById('btnEnvelhecer50').addEventListener('click', () => envelhecerComanda(50));
    document.getElementById('btnEnvelhecer0').addEventListener('click', () => envelhecerComanda(0));

    socket.on('clientes_atualizado', carregarTudo);
    socket.on('cartoes_atualizado', carregarCartoes);
    socket.on('torneiras_atualizado', carregarTorneiras);

    // Mostra qualquer cartão lido (leitor físico OU simulador) no visual — útil para teste
    socket.on('nfc_lido', (data) => {
        if (!data || !data.uid) return;
        const reader = document.getElementById('leitorReader');
        const readerText = document.getElementById('readerText');
        if (reader) reader.classList.add('lendo');
        if (readerText) readerText.textContent = 'Cartão lido: ' + data.uid;
        setTimeout(() => {
            if (reader) reader.classList.remove('lendo');
            if (readerText) readerText.textContent = 'Aguardando cartão...';
        }, 2200);
    });
});
