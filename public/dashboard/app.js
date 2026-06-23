// Painel de Gestão — modelo Comanda Digital
let torneiras = [];

const estiloPorChopp = {
    'Pilsen':           'Pilsen Lager',
    'IPA':              'India Pale Ale',
    'Session':          'Session IPA',
    'RIS':              'Russian Imperial Stout',
    'Rapsodia':         'Saison Belga',
    'Pilsen Imperial':  'Pilsen Lager',
    'IPA Maracujá':     'India Pale Ale',
    'Weiss Trigo':      'Weissbier',
    'Double Stout':     'Imperial Stout',
    'Torneira Livre':   'Sem Chopp'
};

function brl(v) {
    return 'R$ ' + parseFloat(v || 0).toFixed(2).replace('.', ',');
}

// Carregar dados da página
async function carregarDadosPagina() {
    await carregarTorneiras();
    await Promise.all([
        carregarPainel(),
        carregarComandasAbertas()
    ]);
    await carregarNotificacoes();
}

// Buscar torneiras
async function carregarTorneiras() {
    try {
        const res = await fetch('/api/torneiras');
        if (!res.ok) throw new Error();
        torneiras = await res.json();
        renderizarTorneiras();
    } catch (err) {
        showToast('Erro ao carregar torneiras.', 'error');
    }
}

// Renderizar torneiras (mostra preços por copo)
function renderizarTorneiras() {
    const grid = document.getElementById('tapsGrid');
    if (!grid) return;
    grid.innerHTML = '';

    torneiras.sort((a, b) => a.numero - b.numero).forEach(t => {
        const card = document.createElement('div');
        card.className = `tap-card ${t.numero === 5 ? 'large-card' : ''}`;

        let statusClass = 'status-online';
        let statusText = 'Ativa';
        if (t.status === 'inativa') {
            statusClass = 'status-alert';
            statusText = 'Manutenção';
        }

        const isFree = t.chopp_nome === 'Torneira Livre';
        const estiloText = estiloPorChopp[t.chopp_nome] || 'Craft Beer';
        const copo300 = Number(t.preco_copo_300 || 0);
        const copo500 = Number(t.preco_copo_500 || 0);

        if (isFree) {
            card.innerHTML = `
                <div class="tap-header">
                    <div class="tap-id-group">
                        <div class="tap-label">Torneira</div>
                        <div class="tap-number">${t.numero}</div>
                    </div>
                    <span class="tap-status ${statusClass}">
                        <span class="status-dot-indicator"></span>
                        ${statusText}
                    </span>
                </div>
                <div class="tap-body">
                    <div class="tap-beer tap-beer-free">Sem chopp vinculado</div>
                </div>
                <div class="tap-footer" style="justify-content: flex-end;">
                    <a href="/torneiras/" style="color: var(--primary); text-decoration: none; font-weight: 600;">Configurar &rarr;</a>
                </div>
            `;
        } else {
            card.innerHTML = `
                <div class="tap-header">
                    <div class="tap-id-group">
                        <div class="tap-label">Torneira</div>
                        <div class="tap-number">${t.numero}</div>
                    </div>
                    <span class="tap-status ${statusClass}">
                        <span class="status-dot-indicator"></span>
                        ${statusText}
                    </span>
                </div>
                <div class="tap-body">
                    <div class="tap-beer">${t.chopp_nome}</div>
                    <div class="tap-style">${estiloText}</div>
                </div>
                <div class="tap-footer">
                    <span>300ml: <strong>${brl(copo300)}</strong></span>
                    <span>500ml: <strong>${brl(copo500)}</strong></span>
                </div>
            `;
        }

        grid.appendChild(card);
    });
}

// KPIs + últimos consumos
async function carregarPainel() {
    try {
        const res = await fetch('/api/relatorios/painel');
        if (!res.ok) throw new Error();
        const data = await res.json();

        renderizarTabelaUltimosConsumos(data.ultimosConsumos);
        atualizarKPIs(data);
    } catch (err) {
        showToast('Erro ao carregar indicadores.', 'error');
    }
}

function atualizarKPIs(data) {
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    set('kpiClientes',     data.totalClientes ?? '—');
    set('kpiEmAberto',     data.totalEmAberto != null ? brl(data.totalEmAberto) : '—');
    set('kpiDevedores',    data.totalDevedores ?? '0');
    set('kpiRecebidoHoje', data.recebidoHoje != null ? brl(data.recebidoHoje) : '—');
}

function renderizarTabelaUltimosConsumos(consumos) {
    const corpo = document.getElementById('latestSessionsBody');
    if (!corpo) return;
    corpo.innerHTML = '';

    if (!consumos || consumos.length === 0) {
        corpo.innerHTML = `
            <tr>
                <td colspan="4" style="text-align: center; color: var(--text-muted); font-style: italic; padding: 1.5rem 0;">
                    Nenhum consumo recente.
                </td>
            </tr>
        `;
        return;
    }

    consumos.slice(0, 7).forEach(c => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${c.cliente_nome}</strong></td>
            <td>Torneira #${c.torneira_numero || '-'}</td>
            <td>${c.tamanho_ml} ml</td>
            <td style="color: var(--primary); font-weight: 600;">${brl(c.valor)}</td>
        `;
        corpo.appendChild(tr);
    });
}

// Comandas em aberto (lista de devedores)
async function carregarComandasAbertas() {
    const list = document.getElementById('activeSessionsList');
    if (!list) return;
    list.innerHTML = '';

    try {
        const res = await fetch('/api/comandas-abertas');
        const lista = res.ok ? await res.json() : [];

        if (lista.length === 0) {
            list.innerHTML = `
                <div style="text-align: center; color: var(--text-muted); font-style: italic; padding: 2rem 0; font-size: 0.85rem;">
                    Nenhuma comanda em aberto no momento.
                </div>
            `;
            return;
        }

        lista.forEach(c => {
            const card = document.createElement('div');
            card.className = 'card session-active-card';
            card.innerHTML = `
                <div class="session-header">
                    <strong>${c.nome}</strong>
                    <span style="color: var(--primary); font-weight: 700;">${brl(c.total)}</span>
                </div>
                <div style="font-size: 0.75rem; color: var(--text-muted);">
                    ${c.qtd_itens} item(ns) &middot; ${c.cpf || c.telefone || 'sem CPF'}
                </div>
            `;
            list.appendChild(card);
        });
    } catch (err) {
        console.error('Erro ao carregar comandas abertas', err);
    }
}

// Notificações
async function carregarNotificacoes() {
    const list = document.getElementById('notificationsList');
    if (!list) return;
    list.innerHTML = '';

    try {
        // 1. Torneiras inativas
        torneiras.forEach(t => {
            if (t.status === 'inativa') {
                const card = document.createElement('div');
                card.className = 'notification-card alert';
                const nowStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                card.innerHTML = `
                    <div class="notif-header">
                        <span>Alerta</span>
                        <span>Torneira #${t.numero}</span>
                    </div>
                    <div class="notif-body">
                        Torneira #${t.numero} está em manutenção ou desativada no sistema.
                    </div>
                    <div class="notif-time">${nowStr}</div>
                `;
                list.appendChild(card);
            }
        });

        // 2. Estornos recentes
        const res = await fetch('/api/estornos');
        const estornos = res.ok ? await res.json() : [];
        estornos.slice(0, 3).forEach(e => {
            const card = document.createElement('div');
            card.className = 'notification-card chargeback';
            const hora = new Date(e.criado_em).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            card.innerHTML = `
                <div class="notif-header">
                    <span>Estorno Realizado</span>
                    <span>${brl(e.valor)}</span>
                </div>
                <div class="notif-body">
                    Estorno para <strong>${e.cliente_nome}</strong>.<br>
                    <span style="color: var(--text-muted); font-size: 0.75rem;">Motivo: ${e.motivo}</span>
                </div>
                <div class="notif-time">${hora}</div>
            `;
            list.appendChild(card);
        });

        // 3. Últimos consumos lançados
        const resRel = await fetch('/api/relatorios/painel');
        const dataRel = resRel.ok ? await resRel.json() : {};
        const ultimos = dataRel.ultimosConsumos || [];
        ultimos.slice(0, 3).forEach(c => {
            const card = document.createElement('div');
            card.className = 'notification-card confirm';
            const hora = new Date(c.criado_em).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            card.innerHTML = `
                <div class="notif-header">
                    <span>Consumo Lançado</span>
                    <span>${c.tamanho_ml}ml</span>
                </div>
                <div class="notif-body">
                    <strong>${c.cliente_nome}</strong> — ${c.chopp_nome} (Torneira #${c.torneira_numero || '-'}).
                </div>
                <div class="notif-time">${hora}</div>
            `;
            list.appendChild(card);
        });

        if (list.children.length === 0) {
            list.innerHTML = '<div style="text-align:center; color: var(--text-muted); font-style: italic; padding: 2rem 0; font-size: 0.8rem;">Sem notificações recentes.</div>';
        }
    } catch (err) {
        console.error(err);
    }
}

// Websocket: atualizações em tempo real
socket.on('comandas_atualizado', carregarDadosPagina);
socket.on('clientes_atualizado', carregarDadosPagina);
socket.on('torneiras_atualizado', carregarDadosPagina);
socket.on('estornos_atualizado', carregarNotificacoes);

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    carregarDadosPagina();
});
