// Torneiras Management Script

let torneiras = [];

// Formata número como "R$ 0,00" (vírgula decimal)
function formatBRL(valor) {
    return 'R$ ' + (Number(valor) || 0).toFixed(2).replace('.', ',');
}

// Escapa texto para uso seguro em innerHTML
function escaparHtmlTorneira(txt) {
    return String(txt ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Load all page data
async function carregarDadosPagina() {
    await carregarTorneiras();
    await carregarNotificacoes();
}

// Get taps
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

// Render taps grid
function renderizarTorneiras() {
    const grid = document.getElementById('tapsManagerGrid');
    if (!grid) return;
    grid.innerHTML = '';

    if (torneiras.length === 0) {
        grid.innerHTML = '<div style="grid-column: 1/-1; color: var(--text-muted); text-align: center; font-style: italic;">Nenhuma torneira configurada.</div>';
        return;
    }

    torneiras.sort((a, b) => a.numero - b.numero).forEach(t => {
        const card = document.createElement('div');
        card.className = 'manager-card';

        const semBarril = !t.barril_id;
        const statusText = t.status === 'ativa' ? 'Ativa' : 'Manutenção';
        const statusClass = t.status === 'ativa' ? 'ativa' : 'inativa';
        const copo300 = Number(t.preco_copo_300 || 0);
        const copo500 = Number(t.preco_copo_500 || 0);
        const copo1000 = Number(t.preco_copo_1000 || 0);

        // Estilo + marca (do barril montado) — exibidos pequenos embaixo do nome
        const subPartes = [t.barril_estilo, t.barril_marca].filter(Boolean).map(s => escaparHtmlTorneira(s));
        const subChopp = subPartes.length ? subPartes.join(' · ') : '';

        card.innerHTML = `
            <div class="manager-header">
                <span class="manager-tap-label"><i class="fa-solid fa-beer-mug-empty"></i> Torneira ${t.numero}</span>
                <span class="manager-status ${statusClass}">
                    <span class="status-dot-indicator" style="width: 6px; height: 6px; border-radius: 50%; background-color: currentColor;"></span>
                    ${statusText}
                </span>
            </div>
            <div class="manager-body">
                ${semBarril ? `
                    <div class="manager-beer-nome vazio">Sem barril montado</div>
                    <div class="manager-beer-sub"><i class="fa-solid fa-circle-info"></i> Monte um barril em Estoque para definir o chopp.</div>
                ` : `
                    <div class="manager-beer-nome">${escaparHtmlTorneira(t.chopp_nome)}</div>
                    ${subChopp ? `<div class="manager-beer-sub">${subChopp}</div>` : ''}
                `}
                <div class="manager-precos">
                    <div class="manager-price"><span>${nomeTamanho(300)}</span><strong>${formatBRL(copo300)}</strong></div>
                    <div class="manager-price"><span>${nomeTamanho(500)}</span><strong>${formatBRL(copo500)}</strong></div>
                    <div class="manager-price"><span>${nomeTamanho(1000)}</span><strong>${formatBRL(copo1000)}</strong></div>
                </div>
            </div>
            <div class="manager-footer">
                <button class="btn btn-secondary btn-sm" onclick="abrirConfigTorneira(${t.numero})">
                    <i class="fa-solid fa-sliders"></i> Configurar preços
                </button>
                <button class="btn btn-sm ${t.status === 'ativa' ? 'btn-secondary' : 'btn-primary'}" style="${t.status === 'ativa' ? 'border-color: rgba(132,204,22,0.4); color: var(--accent-lime);' : ''}" onclick="toggleStatusTorneira(${t.id}, '${t.status}')">
                    <i class="fa-solid ${t.status === 'ativa' ? 'fa-ban' : 'fa-check'}"></i> ${t.status === 'ativa' ? 'Desativar' : 'Ativar'}
                </button>
            </div>
        `;
        grid.appendChild(card);
    });
}

// Toggle status (ativa/inativa)
async function toggleStatusTorneira(id, currentStatus) {
    const novoStatus = currentStatus === 'ativa' ? 'inativa' : 'ativa';
    try {
        const res = await fetch(`/api/torneiras/${id}/status`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: novoStatus })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        showToast('Status da torneira atualizado!', 'success');
        await carregarTorneiras();
        await carregarNotificacoes();
    } catch (err) {
        showToast(err.message || 'Erro ao alterar status da torneira.', 'error');
    }
}

// Open config modal
async function abrirConfigTorneira(numero) {
    const torneira = torneiras.find(t => t.numero === numero);
    if (!torneira) return;

    document.getElementById('vincularTorneiraNumero').value = numero;
    document.getElementById('vincularTorneiraLabel').innerText = numero;

    // Chopp atual (read-only, vem do barril montado)
    const choppAtual = torneira.barril_id && torneira.chopp_nome ? torneira.chopp_nome : 'Sem barril montado';
    document.getElementById('configChoppAtual').value = choppAtual;

    // Preenche com os preços atuais da torneira (se houver)
    document.getElementById('vincularCopo300').value = torneira.preco_copo_300 ? parseFloat(torneira.preco_copo_300).toFixed(2) : '';
    document.getElementById('vincularCopo500').value = torneira.preco_copo_500 ? parseFloat(torneira.preco_copo_500).toFixed(2) : '';
    document.getElementById('vincularCopo1000').value = torneira.preco_copo_1000 ? parseFloat(torneira.preco_copo_1000).toFixed(2) : '';
    document.getElementById('vincularPrecoInput').value = torneira.chopp_preco_litro ? parseFloat(torneira.chopp_preco_litro).toFixed(2) : '';

    // Limpa sugestões enquanto carrega
    document.getElementById('sugestaoCopo300').innerText = '';
    document.getElementById('sugestaoCopo500').innerText = '';
    document.getElementById('sugestaoCopo1000').innerText = '';

    document.getElementById('modalVincular').classList.add('active');

    // BÔNUS: sugestão de preço com base no barril montado + markup global
    if (torneira.barril_id) {
        await carregarSugestaoPreco(torneira);
    }
}

function fecharConfigTorneira() {
    document.getElementById('modalVincular').classList.remove('active');
}

// BÔNUS: calcula e exibe sugestão de preço (markup global) com base no barril montado
async function carregarSugestaoPreco(torneira) {
    try {
        const [barrisRes, markupRes] = await Promise.all([
            fetch('/api/barris'),
            fetch('/api/config/markup_padrao')
        ]);
        if (!barrisRes.ok || !markupRes.ok) return;

        const barris = await barrisRes.json();
        const markupCfg = await markupRes.json();
        const markup = parseFloat(markupCfg.valor) || 0;

        const barril = barris.find(b => b.torneira_id === torneira.id);
        if (!barril) return;

        const capacidadeLitros = (Number(barril.capacidade_ml) || 0) / 1000;
        if (capacidadeLitros <= 0) return;

        const custoPorLitro = (Number(barril.preco_custo) || 0) / capacidadeLitros;

        const custoCopo300 = custoPorLitro * 0.3;
        const custoCopo500 = custoPorLitro * 0.5;
        const custoCopo1000 = custoPorLitro * 1.0;
        const sugerido300 = custoCopo300 * (1 + markup / 100);
        const sugerido500 = custoCopo500 * (1 + markup / 100);
        const sugerido1000 = custoCopo1000 * (1 + markup / 100);
        const lucro300 = sugerido300 - custoCopo300;
        const lucro500 = sugerido500 - custoCopo500;
        const lucro1000 = sugerido1000 - custoCopo1000;

        document.getElementById('sugestaoCopo300').innerText =
            `Sugerido: ${formatBRL(sugerido300)} (lucro ${formatBRL(lucro300)})`;
        document.getElementById('sugestaoCopo500').innerText =
            `Sugerido: ${formatBRL(sugerido500)} (lucro ${formatBRL(lucro500)})`;
        document.getElementById('sugestaoCopo1000').innerText =
            `Sugerido: ${formatBRL(sugerido1000)} (lucro ${formatBRL(lucro1000)})`;
    } catch (err) {
        console.error('Erro ao calcular sugestão de preço', err);
    }
}

// Submit prices action
async function submeterVinculo(e) {
    if (e) e.preventDefault();
    const numero = parseInt(document.getElementById('vincularTorneiraNumero').value);
    const copo300 = parseFloat(document.getElementById('vincularCopo300').value);
    const copo500 = parseFloat(document.getElementById('vincularCopo500').value);
    const copo1000 = parseFloat(document.getElementById('vincularCopo1000').value);
    const precoLitroRaw = document.getElementById('vincularPrecoInput').value;
    const precoLitro = precoLitroRaw ? parseFloat(precoLitroRaw) : 0;

    const torneira = torneiras.find(t => t.numero === numero);
    if (!torneira) {
        showToast('Torneira não encontrada.', 'error');
        return;
    }
    if (isNaN(copo300) || copo300 < 0 || isNaN(copo500) || copo500 < 0 || isNaN(copo1000) || copo1000 < 0) {
        showToast('Informe os preços dos copos 300ml, 500ml e Growler 1L.', 'error');
        return;
    }
    if (copo300 === 0 && copo500 === 0 && copo1000 === 0) {
        showToast('Defina ao menos um preço de copo maior que zero.', 'error');
        return;
    }

    // O chopp vem do barril montado (torneira atual); não muda aqui
    const choppNome = torneira.chopp_nome;

    try {
        const res = await fetch('/api/torneiras', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                numero,
                chopp_nome: choppNome,
                chopp_preco_litro: precoLitro,
                preco_copo_300: copo300,
                preco_copo_500: copo500,
                preco_copo_1000: copo1000
            })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        showToast(`Preços da Torneira #${numero} salvos!`, 'success');
        fecharConfigTorneira();
        await carregarTorneiras();
        await carregarNotificacoes();
    } catch (err) {
        showToast(err.message || 'Erro ao salvar preços.', 'error');
    }
}

// Load notifications column
async function carregarNotificacoes() {
    const list = document.getElementById('notificationsList');
    if (!list) return;
    list.innerHTML = '';

    try {
        // 1. Manutenção / alertas (Taps inativa)
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

        // 2. Estornos
        const estRes = await fetch('/api/estornos');
        const estornos = estRes.ok ? await estRes.json() : [];
        estornos.slice(0, 3).forEach(e => {
            const card = document.createElement('div');
            card.className = 'notification-card chargeback';
            const hora = new Date(e.criado_em).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            card.innerHTML = `
                <div class="notif-header">
                    <span>Estorno Realizado</span>
                    <span>PIX/Saldo</span>
                </div>
                <div class="notif-body">
                    Estorno de <strong>${formatBRL(e.valor)}</strong> para <strong>${e.cliente_nome}</strong>.
                </div>
                <div class="notif-time">${hora}</div>
            `;
            list.appendChild(card);
        });

        // 3. Confirmations (Consumos lançados nas comandas)
        const relRes = await fetch('/api/relatorios/painel');
        const relData = relRes.ok ? await relRes.json() : {};
        const consumos = relData.ultimosConsumos || [];
        consumos.slice(0, 3).forEach(c => {
            const card = document.createElement('div');
            card.className = 'notification-card confirm';
            const hora = new Date(c.criado_em).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            card.innerHTML = `
                <div class="notif-header">
                    <span>Consumo Lançado</span>
                    <span>Comanda</span>
                </div>
                <div class="notif-body">
                    <strong>${c.cliente_nome}</strong> — copo de <strong>${c.tamanho_ml}ml</strong> (${c.chopp_nome}) na Torneira #${c.torneira_numero}.
                </div>
                <div class="notif-time">${hora}</div>
            `;
            list.appendChild(card);
        });

        if (list.children.length === 0) {
            list.innerHTML = '<div style="text-align: center; color: var(--text-muted); font-style: italic; padding: 2rem 0; font-size: 0.8rem;">Sem notificações recentes.</div>';
        }
    } catch (err) {
        console.error('Erro ao renderizar notificações', err);
    }
}

// Socket updates
socket.on('torneiras_atualizado', () => {
    carregarDadosPagina();
});

// Initialize Page
document.addEventListener('DOMContentLoaded', () => {
    carregarDadosPagina();

    // Form listeners
    const formVincular = document.getElementById('formVincularChopp');
    if (formVincular) formVincular.addEventListener('submit', submeterVinculo);
});
