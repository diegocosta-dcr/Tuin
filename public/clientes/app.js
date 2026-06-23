// Clientes Management Script (modelo Comanda Digital)

let clientes = [];
let cartoes = [];
let clienteSelecionadoId = null;
let abertasPorCliente = {}; // cliente_id -> total em aberto
let substituirNfcAguardando = false;
let clienteTinhaCartaoAtivo = false;
let viaCobrar = false; // 2ª via: false = cortesia (grátis), true = cobrar

// Load general page data
async function carregarDadosPagina() {
    await Promise.all([
        carregarClientes(),
        carregarCartoes(),
        carregarComandasAbertas()
    ]);
    const filtro = document.getElementById('buscarClientesInput')?.value || '';
    renderizarClientes(filtro);
}

// Fetch all clients
async function carregarClientes() {
    try {
        const res = await fetch('/api/clientes');
        if (!res.ok) throw new Error();
        clientes = await res.json();
    } catch (err) {
        showToast('Erro ao carregar lista de clientes.', 'error');
    }
}

// Fetch NFC cards list
async function carregarCartoes() {
    try {
        const res = await fetch('/api/cartoes');
        if (res.ok) cartoes = await res.json();
    } catch (err) {
        console.error('Erro ao buscar cartões', err);
    }
}

// Fetch open tabs (comandas em aberto) -> total per client
async function carregarComandasAbertas() {
    try {
        const res = await fetch('/api/comandas-abertas');
        if (!res.ok) return;
        const lista = await res.json();
        abertasPorCliente = {};
        lista.forEach(c => {
            abertasPorCliente[c.cliente_id] = {
                total: c.total,
                aberta_desde: c.aberta_desde,
                qtd_itens: c.qtd_itens
            };
        });
    } catch (err) {
        console.error('Erro ao buscar comandas abertas', err);
    }
}

function brl(v) {
    return 'R$ ' + parseFloat(v || 0).toFixed(2).replace('.', ',');
}

// Render clients table
function renderizarClientes(filtro = '') {
    const body = document.getElementById('clientesTableBody');
    if (!body) return;

    body.innerHTML = '';

    const query = filtro.trim().toLowerCase();
    const filtrados = clientes.filter(c => {
        const nomeMatch = c.nome.toLowerCase().includes(query);
        const cpfMatch = c.cpf ? c.cpf.includes(query) : false;
        const cardMatch = cartoes.some(card => card.cliente_id === c.id && card.uid.toLowerCase().includes(query));
        return nomeMatch || cpfMatch || cardMatch;
    });

    if (filtrados.length === 0) {
        body.innerHTML = `
            <tr>
                <td colspan="6" class="table-empty">Nenhum cliente correspondente encontrado.</td>
            </tr>
        `;
        return;
    }

    filtrados.forEach(c => {
        const tr = document.createElement('tr');
        const dataCadastro = new Date(c.criado_em).toLocaleDateString('pt-BR');
        const nomeEsc = c.nome.replace(/'/g, "\\'");
        const cpfEsc = (c.cpf || '').replace(/'/g, "\\'");
        const emailEsc = (c.email || '').replace(/'/g, "\\'");
        const telEsc = (c.telefone || '').replace(/'/g, "\\'");

        // Comanda em aberto: valor + cor por tempo (12h amarelo / 48h vermelho)
        const aberta = abertasPorCliente[c.id];
        const emAberto = aberta ? Number(aberta.total) : 0;
        const nivel = (aberta && emAberto > 0) ? nivelComanda(aberta.aberta_desde) : 'normal';
        if (nivel !== 'normal') tr.className = 'comanda-nivel-' + nivel;

        const abertoHtml = emAberto > 0
            ? `<span style="color: var(--gold); font-weight: 700;">${brl(emAberto)}</span>
               <span class="tempo-badge ${nivel !== 'normal' ? nivel : ''}" style="margin-left:0.4rem;">${tempoAberta(aberta.aberta_desde)}</span>`
            : `<span style="color: var(--text-muted);">R$ 0,00</span>`;

        // Marcação de cartão NFC vinculado
        const temCartao = cartoes.some(card => card.cliente_id === c.id && (card.status === 'ativo' || !card.status));
        const cartaoBadge = temCartao
            ? `<span class="cli-cartao ok" title="Cartão NFC vinculado"><i class="fa-solid fa-circle-check"></i> Cartão OK</span>`
            : `<span class="cli-cartao sem" title="Cliente sem cartão"><i class="fa-solid fa-triangle-exclamation"></i> Sem cartão</span>`;

        tr.innerHTML = `
            <td><strong>${c.nome}</strong><div style="margin-top:0.25rem;">${cartaoBadge}</div></td>
            <td>${c.cpf || '<span style="color: var(--text-muted);">Não informado</span>'}</td>
            <td>${c.telefone || '<span style="color: var(--text-muted);">—</span>'}</td>
            <td>${abertoHtml}</td>
            <td>${dataCadastro}</td>
            <td>
                <div style="display:flex; gap:0.4rem;">
                    <button class="btn btn-secondary btn-sm" onclick="abrirSlideOver(${c.id}, '${nomeEsc}', '${cpfEsc}')">
                        <i class="fa-solid fa-clock-rotate-left"></i> Histórico
                    </button>
                    <button class="btn btn-secondary btn-sm" onclick="abrirModalEditarCliente(${c.id}, '${nomeEsc}', '${emailEsc}', '${cpfEsc}', '${telEsc}')">
                        <i class="fa-solid fa-pen"></i> Editar
                    </button>
                </div>
            </td>
        `;
        body.appendChild(tr);
    });
}

// Slideover actions
async function abrirSlideOver(id, nome, cpf) {
    clienteSelecionadoId = id;

    document.getElementById('soClienteNome').innerText = nome;
    document.getElementById('soClienteCPF').innerText = cpf ? `CPF: ${cpf}` : 'CPF: Não informado';
    document.getElementById('soClienteSaldo').innerText = brl(abertasPorCliente[id]?.total || 0);

    switchSlideOverTab('consumo');

    await Promise.all([
        carregarHistoricoConsumos(id),
        carregarHistoricoPagamentos(id),
        carregarHistoricoCartoes(id)
    ]);

    document.getElementById('clientSlideOver').classList.add('active');
}

function fecharSlideOver() {
    document.getElementById('clientSlideOver').classList.remove('active');
    clienteSelecionadoId = null;
}

// Consumos em aberto do cliente (comanda atual)
async function carregarHistoricoConsumos(id) {
    const body = document.getElementById('soConsumosBody');
    if (!body) return;

    try {
        const res = await fetch(`/api/comanda/${id}`);
        if (!res.ok) throw new Error();
        const data = await res.json();
        const itens = data.itens || [];

        body.innerHTML = '';
        if (itens.length === 0) {
            body.innerHTML = '<tr><td colspan="4" class="table-empty">Nenhum consumo em aberto.</td></tr>';
            return;
        }

        itens.forEach(l => {
            const tr = document.createElement('tr');
            const dataHora = new Date(l.criado_em).toLocaleString('pt-BR');
            tr.innerHTML = `
                <td><strong>${l.tamanho_ml} ml</strong></td>
                <td style="color: var(--primary); font-weight: 600;">${brl(l.valor)}</td>
                <td>Torneira #${l.torneira_numero || '-'} (${l.chopp_nome})</td>
                <td style="font-size: 0.75rem;">${dataHora}</td>
            `;
            body.appendChild(tr);
        });
    } catch (err) {
        body.innerHTML = '<tr><td colspan="4" class="table-empty" style="color: var(--primary-red);">Erro ao carregar consumos.</td></tr>';
    }
}

// Histórico de pagamentos do cliente
async function carregarHistoricoPagamentos(id) {
    const body = document.getElementById('soRecargasBody');
    if (!body) return;

    try {
        const res = await fetch(`/api/pagamentos?cliente_id=${id}`);
        if (!res.ok) throw new Error();
        const pagamentos = await res.json();

        body.innerHTML = '';
        if (pagamentos.length === 0) {
            body.innerHTML = '<tr><td colspan="3" class="table-empty">Nenhum pagamento registrado.</td></tr>';
            return;
        }

        pagamentos.forEach(r => {
            const tr = document.createElement('tr');
            const dataHora = new Date(r.criado_em).toLocaleString('pt-BR');
            const rotuloTipo = r.tipo === 'segunda_via' ? ' (2ª via)' : '';
            tr.innerHTML = `
                <td style="color: var(--accent-green); font-weight: 600;">${brl(r.valor)}${rotuloTipo}</td>
                <td><span class="badge-status" style="background: rgba(201,168,76,0.1); color: var(--primary); border: 1px solid rgba(201,168,76,0.15);">${r.metodo}</span></td>
                <td style="font-size: 0.75rem;">${dataHora}</td>
            `;
            body.appendChild(tr);
        });
    } catch (err) {
        body.innerHTML = '<tr><td colspan="3" class="table-empty" style="color: var(--primary-red);">Erro ao carregar pagamentos.</td></tr>';
    }
}

// Obter histórico de cartões do cliente
async function carregarHistoricoCartoes(id) {
    const body = document.getElementById('soCartoesBody');
    if (!body) return;

    try {
        const res = await fetch(`/api/clientes/${id}/cartoes`);
        if (!res.ok) throw new Error();
        const cartoesCliente = await res.json();

        body.innerHTML = '';
        if (cartoesCliente.length === 0) {
            body.innerHTML = '<tr><td colspan="4" class="table-empty">Nenhum cartão associado.</td></tr>';
            return;
        }

        cartoesCliente.forEach((card, index) => {
            const tr = document.createElement('tr');
            const dataHora = new Date(card.criado_em).toLocaleString('pt-BR');
            const statusHtml = card.status === 'ativo'
                ? `<span class="badge-status" style="background: rgba(40,167,69,0.1); color: var(--accent-green); border: 1px solid rgba(40,167,69,0.15);">Ativo</span>`
                : `<span class="badge-status" style="background: rgba(220,53,69,0.1); color: var(--primary-red); border: 1px solid rgba(220,53,69,0.15);">Inativo</span>`;
            
            tr.innerHTML = `
                <td><strong>${index + 1}ª Via</strong></td>
                <td><code style="font-family: monospace; font-size: 0.9rem;">${card.uid}</code></td>
                <td>${statusHtml}</td>
                <td style="font-size: 0.75rem;">${dataHora}</td>
            `;
            body.appendChild(tr);
        });
    } catch (err) {
        body.innerHTML = '<tr><td colspan="4" class="table-empty" style="color: var(--primary-red);">Erro ao carregar cartões.</td></tr>';
    }
}

// Switch tabs inside slide-over
function switchSlideOverTab(tab) {
    const tabs = document.querySelectorAll('.so-tab-content');
    const buttons = document.querySelectorAll('.so-tab-btn');

    tabs.forEach(t => t.classList.remove('active'));
    buttons.forEach(b => b.classList.remove('active'));

    if (tab === 'consumo') {
        document.getElementById('soTabConsumo').classList.add('active');
        buttons[0].classList.add('active');
    } else if (tab === 'recarga') {
        document.getElementById('soTabRecarga').classList.add('active');
        buttons[1].classList.add('active');
    } else {
        document.getElementById('soTabCartoes').classList.add('active');
        buttons[2].classList.add('active');
    }
}

// Real-time socket updates
async function atualizarTudoTempoReal() {
    await carregarDadosPagina();
    if (clienteSelecionadoId) {
        document.getElementById('soClienteSaldo').innerText = brl(abertasPorCliente[clienteSelecionadoId]?.total || 0);
        await Promise.all([
            carregarHistoricoConsumos(clienteSelecionadoId),
            carregarHistoricoPagamentos(clienteSelecionadoId),
            carregarHistoricoCartoes(clienteSelecionadoId)
        ]);
    }
}

socket.on('clientes_atualizado', atualizarTudoTempoReal);
socket.on('comandas_atualizado', atualizarTudoTempoReal);
socket.on('cartoes_atualizado', () => carregarDadosPagina());

// NFC detection swipe inside Clientes view
socket.on('nfc_lido', async (data) => {
    const uid = data.uid;
    
    // Se estiver aguardando substituição de cartão, captura no modal de edição
    if (substituirNfcAguardando) {
        await handleSubstituirNfcLido(uid);
        return;
    }

    // Se estiver aguardando cadastro/recarga global, ignora busca
    if (typeof recargaNfcAguardando !== 'undefined' && recargaNfcAguardando) return;
    if (typeof cadastroNfcAguardando !== 'undefined' && cadastroNfcAguardando) return;

    try {
        const response = await fetch(`/api/cartoes/${uid}`);
        if (response.ok) {
            const card = await response.json();
            const searchInput = document.getElementById('buscarClientesInput');
            if (searchInput) {
                searchInput.value = card.cliente_nome;
                renderizarClientes(card.cliente_nome);
            }
            showToast(`Filtro NFC aplicado para: ${card.cliente_nome}`, 'success');
            abrirSlideOver(card.cliente_id, card.cliente_nome, card.cliente_cpf);
        }
    } catch (err) {
        console.error('NFC error', err);
    }
});

// Captura scan NFC no fluxo de substituição do modal de edição
async function handleSubstituirNfcLido(uid) {
    try {
        // Verifica se o cartão já está em uso por outro cliente ativo
        const response = await fetch(`/api/cartoes/${uid}`);
        if (response.ok) {
            const card = await response.json();
            showToast(`Este cartão já está cadastrado para o cliente: ${card.cliente_nome}`, 'warning');
            return;
        }
        
        // Cartão livre, registra o UID
        document.getElementById('substituirNfcUid').value = uid;
        document.getElementById('substituirNfcStatus').innerText = `Novo cartão detectado: ${uid}`;
        
        // Se o cliente já tinha cartão, mostra a área de cobrança da 2ª via
        if (clienteTinhaCartaoAtivo) {
            const resConfig = await fetch('/api/config/valor_segunda_via');
            let valor = '10,00';
            if (resConfig.ok) {
                const cfg = await resConfig.json();
                if (cfg && cfg.valor) {
                    valor = parseFloat(cfg.valor).toFixed(2).replace('.', ',');
                }
            }
            document.getElementById('substituirPrecoTexto').innerText = `R$ ${valor}`;
            document.getElementById('substituirPagamentoArea').style.display = 'block';
            selecionarVia(false); // padrão: cortesia (não cobra) — decisão consciente do atendente
        } else {
            document.getElementById('substituirPagamentoArea').style.display = 'none';
        }

        showToast('Novo cartão detectado com sucesso!', 'success');
    } catch (err) {
        showToast('Erro ao ler cartão para substituição.', 'error');
    }
}

// Escolhe se a 2ª via será cortesia (false) ou cobrada (true)
function selecionarVia(cobrar) {
    viaCobrar = !!cobrar;
    const btnCort = document.getElementById('btnViaCortesia');
    const btnCob = document.getElementById('btnViaCobrar');
    const metodoWrap = document.getElementById('substituirMetodoWrap');
    if (btnCort) btnCort.classList.toggle('active', !viaCobrar);
    if (btnCob) btnCob.classList.toggle('active', viaCobrar);
    if (metodoWrap) metodoWrap.style.display = viaCobrar ? 'block' : 'none';
}

// Alternar modo de aguardo de scan no modal de edição
function alternarAguardarSubstituicao() {
    const secao = document.getElementById('secaoSubstituirNfc');
    const btn = document.getElementById('btnSubstituirCartao');
    if (!secao || !btn) return;
    
    if (secao.style.display === 'none') {
        secao.style.display = 'block';
        substituirNfcAguardando = true;
        document.getElementById('substituirNfcStatus').innerText = 'Aproxime o novo cartão NFC...';
        document.getElementById('substituirNfcUid').value = '';
        document.getElementById('substituirPagamentoArea').style.display = 'none';
        btn.innerHTML = '<i class="fa-solid fa-xmark"></i> Cancelar Substituição';
        btn.className = 'btn btn-secondary btn-sm btn-danger';
    } else {
        secao.style.display = 'none';
        substituirNfcAguardando = false;
        document.getElementById('substituirNfcUid').value = '';
        btn.innerHTML = clienteTinhaCartaoAtivo 
            ? '<i class="fa-solid fa-exchange-alt"></i> Substituir Cartão (2ª Via)'
            : '<i class="fa-solid fa-plus"></i> Vincular Novo Cartão (1ª Via)';
        btn.className = 'btn btn-secondary btn-sm';
    }
}

// Edit client modal
async function abrirModalEditarCliente(id, nome, email, cpf, telefone) {
    document.getElementById('editarClienteId').value = id;
    document.getElementById('editarClienteNome').value = nome;
    document.getElementById('editarClienteEmail').value = email;
    document.getElementById('editarClienteCpf').value = cpf;
    const telEl = document.getElementById('editarClienteTelefone');
    if (telEl) telEl.value = telefone || '';
    
    // Reset substituição
    substituirNfcAguardando = false;
    clienteTinhaCartaoAtivo = false;
    document.getElementById('substituirNfcUid').value = '';
    document.getElementById('secaoSubstituirNfc').style.display = 'none';
    document.getElementById('substituirPagamentoArea').style.display = 'none';
    
    const btnSub = document.getElementById('btnSubstituirCartao');
    if (btnSub) {
        btnSub.innerHTML = '<i class="fa-solid fa-exchange-alt"></i> Substituir Cartão (2ª Via)';
        btnSub.className = 'btn btn-secondary btn-sm';
    }

    // Carregar informações do cartão ativo
    const infoEl = document.getElementById('editarCartaoInfo');
    if (infoEl) infoEl.innerHTML = '<span style="color: var(--text-muted);">Carregando informações do cartão...</span>';
    
    try {
        const res = await fetch(`/api/clientes/${id}/cartoes`);
        if (!res.ok) throw new Error();
        const list = await res.json();
        const activeCard = list.find(c => c.status === 'ativo');
        
        if (activeCard) {
            clienteTinhaCartaoAtivo = true;
            const index = list.indexOf(activeCard);
            infoEl.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <div>
                        <strong style="color:var(--primary);">${index + 1}ª Via Ativa</strong>
                        <div style="font-size:0.75rem; color:var(--text-muted); font-family:monospace; margin-top:0.25rem;">UID: ${activeCard.uid}</div>
                    </div>
                    <span class="badge-status" style="background: rgba(40,167,69,0.1); color: var(--accent-green); border: 1px solid rgba(40,167,69,0.15);">Ativo</span>
                </div>
            `;
            if (btnSub) btnSub.innerHTML = '<i class="fa-solid fa-exchange-alt"></i> Substituir Cartão (2ª Via)';
        } else {
            clienteTinhaCartaoAtivo = false;
            infoEl.innerHTML = '<span style="color: var(--text-muted);">Nenhum cartão ativo associado.</span>';
            if (btnSub) btnSub.innerHTML = '<i class="fa-solid fa-plus"></i> Vincular Novo Cartão (1ª Via)';
        }
    } catch (err) {
        if (infoEl) infoEl.innerHTML = '<span style="color: var(--primary-red);">Erro ao verificar cartões.</span>';
    }

    document.getElementById('modalEditarCliente').classList.add('active');
}

function fecharModalEditarCliente() {
    document.getElementById('modalEditarCliente').classList.remove('active');
    substituirNfcAguardando = false;
}

async function submeterEdicaoCliente(e) {
    e.preventDefault();
    const id = document.getElementById('editarClienteId').value;
    const nome = document.getElementById('editarClienteNome').value.trim();
    const email = document.getElementById('editarClienteEmail').value.trim();
    const cpf = document.getElementById('editarClienteCpf').value.trim();
    const telEl = document.getElementById('editarClienteTelefone');
    const telefone = telEl ? telEl.value.trim() : '';

    if (!nome) {
        showToast('Nome é obrigatório.', 'error');
        return;
    }

    try {
        // 1. Atualiza os dados cadastrais
        const res = await fetch(`/api/clientes/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nome, email, cpf, telefone })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        // 2. Se houver nova substituição de cartão vinculada
        const novoUid = document.getElementById('substituirNfcUid').value;
        if (substituirNfcAguardando && novoUid) {
            // Cortesia (grátis) por padrão; só cobra se o atendente escolher "Cobrar"
            let metodo = 'Gratis';
            if (clienteTinhaCartaoAtivo && viaCobrar) {
                metodo = document.getElementById('substituirMetodoPagamento').value;
            }

            const cardRes = await fetch('/api/cartoes', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ uid: novoUid, clienteId: id, metodo })
            });
            const cardData = await cardRes.json();
            if (!cardRes.ok) throw new Error(cardData.error || 'Erro ao vincular cartão');
            const cobrou = clienteTinhaCartaoAtivo && viaCobrar;
            showToast(cobrou ? 'Cartão associado e 2ª via cobrada!' : 'Novo cartão associado (cortesia).', 'success');
        } else {
            showToast('Cliente atualizado!', 'success');
        }

        fecharModalEditarCliente();
        await carregarDadosPagina();
    } catch (err) {
        showToast(err.message || 'Erro ao editar cliente.', 'error');
    }
}

// Initialize Page
document.addEventListener('DOMContentLoaded', () => {
    carregarDadosPagina();

    const searchInput = document.getElementById('buscarClientesInput');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            renderizarClientes(e.target.value);
        });
    }

    const formEditar = document.getElementById('formEditarCliente');
    if (formEditar) formEditar.addEventListener('submit', submeterEdicaoCliente);

    // Botões de escolha da 2ª via (cortesia x cobrar)
    const btnCort = document.getElementById('btnViaCortesia');
    const btnCob = document.getElementById('btnViaCobrar');
    if (btnCort) btnCort.addEventListener('click', () => selecionarVia(false));
    if (btnCob) btnCob.addEventListener('click', () => selecionarVia(true));

    // Botão de substituir cartão no modal de edição
    const btnSubstituir = document.getElementById('btnSubstituirCartao');
    if (btnSubstituir) {
        btnSubstituir.addEventListener('click', alternarAguardarSubstituicao);
    }
});
