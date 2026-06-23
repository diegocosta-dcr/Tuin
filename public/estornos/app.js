// Estornos Management Script

let todosClientes = [];
let todosCartoes = [];

// Load general page history
async function carregarDadosPagina() {
    await carregarEstornosGerais();
    await carregarListasDeBusca();
}

// Fetch general estorno logs
async function carregarEstornosGerais() {
    const body = document.getElementById('estornosGeraisTableBody');
    if (!body) return;

    try {
        const res = await fetch('/api/estornos');
        if (!res.ok) throw new Error();
        const data = await res.json();

        body.innerHTML = '';
        if (data.length === 0) {
            body.innerHTML = `
                <tr>
                    <td colspan="7" class="table-empty">Nenhum estorno realizado no sistema.</td>
                </tr>
            `;
            return;
        }

        data.forEach(e => {
            const tr = document.createElement('tr');
            const dataHora = new Date(e.criado_em).toLocaleString('pt-BR');
            tr.innerHTML = `
                <td><strong>${e.cliente_nome}</strong></td>
                <td>${e.cliente_cpf || '<span style="color: var(--text-muted);">Não informado</span>'}</td>
                <td style="color: #AFA9EC; font-weight: 600;">R$ ${parseFloat(e.valor).toFixed(2)}</td>
                <td>Torneira #${e.torneira_numero}</td>
                <td>${e.chopp_nome}</td>
                <td>${e.motivo}</td>
                <td>${dataHora}</td>
            `;
            body.appendChild(tr);
        });
    } catch (err) {
        body.innerHTML = `<tr><td colspan="7" class="table-empty" style="color: var(--primary-red);">Erro ao carregar histórico.</td></tr>`;
    }
}

// Load background lists for search
async function carregarListasDeBusca() {
    try {
        const [cliRes, cardRes] = await Promise.all([
            fetch('/api/clientes'),
            fetch('/api/cartoes')
        ]);
        if (cliRes.ok) todosClientes = await cliRes.json();
        if (cardRes.ok) todosCartoes = await cardRes.json();
    } catch (err) {
        console.error('Erro ao pré-carregar listas de busca', err);
    }
}

// Search action
function buscarClientesEstorno() {
    const query = document.getElementById('buscarClienteEstornoInput').value.trim().toLowerCase();
    const resultsBox = document.getElementById('estornoClientResults');
    
    if (!resultsBox) return;
    resultsBox.innerHTML = '';

    if (!query) {
        resultsBox.style.display = 'none';
        return;
    }

    // Filter matching clients
    const matches = todosClientes.filter(c => {
        const nomeMatch = c.nome.toLowerCase().includes(query);
        const cpfMatch = c.cpf ? c.cpf.includes(query) : false;
        
        // Find if this client has any cards matching query
        const cardMatch = todosCartoes.some(card => card.cliente_id === c.id && card.uid.toLowerCase().includes(query));

        return nomeMatch || cpfMatch || cardMatch;
    });

    if (matches.length === 0) {
        resultsBox.innerHTML = '<div style="padding: 0.5rem; font-size: 0.8rem; color: var(--text-muted); font-style: italic;">Nenhum cliente correspondente.</div>';
    } else {
        matches.forEach(c => {
            const item = document.createElement('div');
            item.className = 'client-result-item';
            item.innerHTML = `
                <span><strong>${c.nome}</strong></span>
                <span class="cpf">${c.cpf ? `CPF: ${c.cpf}` : 'Sem CPF'}</span>
            `;
            item.onclick = () => selecionarClienteReembolso(c.id, c.nome);
            resultsBox.appendChild(item);
        });
    }

    resultsBox.style.display = 'block';
}

// Select client and query latest session
async function selecionarClienteReembolso(clienteId, clienteNome) {
    // Hide results box
    const resultsBox = document.getElementById('estornoClientResults');
    if (resultsBox) resultsBox.style.display = 'none';

    const panel = document.getElementById('estornoSessaoPanel');
    const alertBox = document.getElementById('estornoNenhumaSessao');
    
    try {
        const res = await fetch(`/api/clientes/${clienteId}/ultima-sessao`);
        if (!res.ok) {
            // No refundable session found
            panel.style.display = 'none';
            alertBox.style.display = 'block';
            return;
        }

        const sessao = await res.json();
        
        // Populate session info
        document.getElementById('estornoSessaoId').value = sessao.id;
        document.getElementById('estornoClienteLabel').innerText = clienteNome;
        document.getElementById('estornoTorneiraLabel').innerText = `#${sessao.torneira_numero}`;
        document.getElementById('estornoChoppLabel').innerText = sessao.chopp_nome;
        document.getElementById('estornoVolumeLabel').innerText = `${parseFloat(sessao.ml_consumido).toFixed(0)} ml`;
        document.getElementById('estornoValorLabel').innerText = `R$ ${parseFloat(sessao.valor_pago).toFixed(2)}`;

        alertBox.style.display = 'none';
        panel.style.display = 'block';
    } catch (err) {
        panel.style.display = 'none';
        alertBox.style.display = 'block';
    }
}

// Submit refund confirmation
async function processarConfirmacaoEstorno(e) {
    if (e) e.preventDefault();

    const sessaoId = document.getElementById('estornoSessaoId').value;
    const motivo = document.getElementById('estornoMotivoInput').value.trim();

    if (!sessaoId || !motivo) {
        showToast('Preencha o motivo do estorno.', 'error');
        return;
    }

    try {
        const res = await fetch('/api/estornos', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessaoId, motivo })
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        showToast('Estorno realizado com sucesso!', 'success');
        fecharModalEstorno();
        carregarDadosPagina();
    } catch (err) {
        showToast(err.message || 'Erro ao realizar estorno.', 'error');
    }
}

// Open modal
function abrirModalEstorno() {
    document.getElementById('buscarClienteEstornoInput').value = '';
    const resultsBox = document.getElementById('estornoClientResults');
    if (resultsBox) resultsBox.style.display = 'none';
    
    document.getElementById('estornoSessaoPanel').style.display = 'none';
    document.getElementById('estornoNenhumaSessao').style.display = 'none';
    document.getElementById('formConfirmarEstorno').reset();

    // Reload search lists
    carregarListasDeBusca();

    document.getElementById('modalNovoEstorno').classList.add('active');
}

// Close modal
function fecharModalEstorno() {
    document.getElementById('modalNovoEstorno').classList.remove('active');
}

// Listen to NFC Card swipes specifically for the Novo Estorno Modal
socket.on('nfc_lido', async (data) => {
    const modal = document.getElementById('modalNovoEstorno');
    if (modal && modal.classList.contains('active')) {
        const uid = data.uid;
        try {
            const card = todosCartoes.find(c => c.uid.toLowerCase() === uid.toLowerCase());
            if (card) {
                showToast(`Cartão de ${card.cliente_nome} aproximado.`, 'success');
                selecionarClienteReembolso(card.cliente_id, card.cliente_nome);
            } else {
                // Fetch directly from server just in case
                const response = await fetch(`/api/cartoes/${uid}`);
                if (response.ok) {
                    const dbCard = await response.json();
                    showToast(`Cartão de ${dbCard.cliente_nome} aproximado.`, 'success');
                    selecionarClienteReembolso(dbCard.cliente_id, dbCard.cliente_nome);
                } else {
                    showToast('Cartão NFC aproximado não possui cliente associado.', 'error');
                }
            }
        } catch (err) {
            console.error('Erro ao processar NFC no modal de estorno', err);
        }
    }
});

socket.on('estornos_atualizado', () => {
    carregarEstornosGerais();
});

// Initialize Page
document.addEventListener('DOMContentLoaded', () => {
    carregarDadosPagina();

    // Bind Button Click
    const btnNovo = document.getElementById('btnNovoEstorno');
    if (btnNovo) btnNovo.addEventListener('click', abrirModalEstorno);

    // Form submit
    const formConfirmar = document.getElementById('formConfirmarEstorno');
    if (formConfirmar) formConfirmar.addEventListener('submit', processarConfirmacaoEstorno);

    // Input listeners
    const searchInput = document.getElementById('buscarClienteEstornoInput');
    if (searchInput) searchInput.addEventListener('input', buscarClientesEstorno);
});
