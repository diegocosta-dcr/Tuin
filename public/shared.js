// Immediately load theme to prevent flashing
(function() {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'light') {
        document.documentElement.classList.add('light-theme');
    }
})();

// Global connection to Socket.io
const socket = io();

// Theme Toggle Functionality
function toggleTheme() {
    const isLight = document.documentElement.classList.toggle('light-theme');
    localStorage.setItem('theme', isLight ? 'light' : 'dark');
}

// Global NFC detection states for modals
let recargaNfcAguardando = false;
let cadastroNfcAguardando = false;
let nfcCardDetectado = null; // UID do cartão aproximado

// Websocket Connection Status
socket.on('connect', () => {
    const badge = document.getElementById('statusBadge');
    if (badge) {
        badge.className = 'badge-status';
        badge.innerHTML = '<span class="status-dot"></span> Online';
    }
});

socket.on('disconnect', () => {
    const badge = document.getElementById('statusBadge');
    if (badge) {
        badge.className = 'badge-status offline';
        badge.innerHTML = '<span class="status-dot"></span> Offline';
    }
});

// listen to NFC Card scans from the simulator
socket.on('nfc_lido', async (data) => {
    const uid = data.uid;
    
    // 1. Handling inside Recarga Modal
    if (recargaNfcAguardando) {
        try {
            const response = await fetch(`/api/cartoes/${uid}`);
            if (!response.ok) {
                showToast('Cartão NFC não cadastrado! Cadastre o cliente primeiro.', 'error');
                return;
            }
            const cartao = await response.json();
            
            nfcCardDetectado = uid;
            document.getElementById('recargaNfcStatus').innerText = `Cartão detectado: ${uid}`;
            
            const cardInfo = document.getElementById('recargaCardInfo');
            cardInfo.style.display = 'block';
            document.getElementById('recargaClienteNome').innerText = cartao.cliente_nome;
            document.getElementById('recargaClienteSaldo').innerText = `R$ ${parseFloat(cartao.cliente_saldo).toFixed(2)}`;
            document.getElementById('recargaClienteId').value = cartao.cliente_id;
            
            showToast(`Cartão de ${cartao.cliente_nome} aproximado.`, 'success');
        } catch (err) {
            showToast('Erro ao ler cartão no servidor.', 'error');
        }
    }
    
    // 2. Handling inside Cadastro Modal
    if (cadastroNfcAguardando) {
        try {
            const response = await fetch(`/api/cartoes/${uid}`);
            if (response.ok) {
                // Cartão já cadastrado - abre perfil e campo de recarga direto
                const cartao = await response.json();
                nfcCardDetectado = uid;
                
                document.getElementById('cadastroNfcStatus').innerText = `Cartão já cadastrado!`;
                document.getElementById('formCadastroModal').style.display = 'none';
                
                const profileInfo = document.getElementById('cadastroPerfilInfo');
                profileInfo.style.display = 'block';
                document.getElementById('cadastroPerfilNome').innerText = cartao.cliente_nome;
                document.getElementById('cadastroPerfilSaldo').innerText = `R$ ${parseFloat(cartao.cliente_saldo).toFixed(2)}`;
                document.getElementById('cadastroPerfilId').value = cartao.cliente_id;
                document.getElementById('cadastroPerfilUid').value = uid;
                
                showToast(`Perfil de ${cartao.cliente_nome} carregado automaticamente.`, 'info');
            } else {
                // Cartão novo - exibe formulário
                nfcCardDetectado = uid;
                document.getElementById('cadastroNfcStatus').innerText = `Novo cartão: ${uid}`;
                document.getElementById('cadastroPerfilInfo').style.display = 'none';
                document.getElementById('formCadastroModal').style.display = 'block';
                document.getElementById('cadastroNfcUid').value = uid;
                
                showToast('Novo cartão detectado. Preencha o formulário.', 'success');
            }
        } catch (err) {
            showToast('Erro ao verificar cartão.', 'error');
        }
    }
});

// ── Idade / nível de uma comanda aberta (cores por tempo) ──
// O SQLite grava datas em UTC ("YYYY-MM-DD HH:MM:SS"); tratamos como UTC.
function idadeComandaHoras(abertaDesde) {
    if (!abertaDesde) return 0;
    const iso = abertaDesde.replace(' ', 'T') + (abertaDesde.includes('Z') ? '' : 'Z');
    const t = new Date(iso).getTime();
    if (isNaN(t)) return 0;
    return (Date.now() - t) / 3600000;
}

// Retorna 'normal' (<12h), 'atencao' (>=12h e <48h) ou 'critico' (>=48h)
function nivelComanda(abertaDesde) {
    const h = idadeComandaHoras(abertaDesde);
    if (h >= 48) return 'critico';
    if (h >= 12) return 'atencao';
    return 'normal';
}

// Texto amigável do tempo decorrido (ex: "3h", "2d 4h")
function tempoAberta(abertaDesde) {
    const h = idadeComandaHoras(abertaDesde);
    if (h < 1) return 'há poucos minutos';
    if (h < 24) return `há ${Math.floor(h)}h`;
    const d = Math.floor(h / 24);
    const rh = Math.floor(h % 24);
    return `há ${d}d${rh ? ' ' + rh + 'h' : ''}`;
}

// Nome amigável da medida de venda (300/500ml ou growler 1L)
function nomeTamanho(ml) {
    const m = parseInt(ml);
    if (m === 1000) return 'Growler 1L';
    return m + 'ml';
}

// ── Máscaras de CPF e telefone ──
function formatarCPF(v) {
    v = (v || '').replace(/\D/g, '').slice(0, 11);
    if (v.length > 9) return v.replace(/(\d{3})(\d{3})(\d{3})(\d{1,2})/, '$1.$2.$3-$4');
    if (v.length > 6) return v.replace(/(\d{3})(\d{3})(\d{1,3})/, '$1.$2.$3');
    if (v.length > 3) return v.replace(/(\d{3})(\d{1,3})/, '$1.$2');
    return v;
}
function formatarTelefone(v) {
    // Celular: (XX) 9XXXX-XXXX (11 dígitos)
    v = (v || '').replace(/\D/g, '').slice(0, 11);
    if (v.length > 10) return v.replace(/(\d{2})(\d{5})(\d{1,4})/, '($1) $2-$3');
    if (v.length > 6) return v.replace(/(\d{2})(\d{4})(\d{1,4})/, '($1) $2-$3');
    if (v.length > 2) return v.replace(/(\d{2})(\d{1,5})/, '($1) $2');
    if (v.length > 0) return '(' + v;
    return v;
}
function soDigitos(v) { return (v || '').replace(/\D/g, ''); }

// Valida CPF pelos dígitos verificadores (algoritmo oficial)
function cpfValido(cpf) {
    cpf = soDigitos(cpf);
    if (cpf.length !== 11) return false;
    if (/^(\d)\1{10}$/.test(cpf)) return false; // rejeita 000..., 111..., etc.
    let soma = 0;
    for (let i = 0; i < 9; i++) soma += parseInt(cpf[i], 10) * (10 - i);
    let d1 = 11 - (soma % 11);
    if (d1 >= 10) d1 = 0;
    if (d1 !== parseInt(cpf[9], 10)) return false;
    soma = 0;
    for (let i = 0; i < 10; i++) soma += parseInt(cpf[i], 10) * (11 - i);
    let d2 = 11 - (soma % 11);
    if (d2 >= 10) d2 = 0;
    return d2 === parseInt(cpf[10], 10);
}

// Adiciona o "olhinho" (mostrar/ocultar) a um campo de senha
function injetarOlho(input) {
    if (!input || input.dataset.olho) return;
    input.dataset.olho = '1';
    const wrap = document.createElement('span');
    wrap.className = 'pwd-wrap';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pwd-olho';
    btn.tabIndex = -1;
    btn.innerHTML = '<i class="fa-solid fa-eye"></i>';
    btn.addEventListener('click', () => {
        const mostrar = input.type === 'password';
        input.type = mostrar ? 'text' : 'password';
        btn.querySelector('i').className = mostrar ? 'fa-solid fa-eye-slash' : 'fa-solid fa-eye';
    });
    wrap.appendChild(btn);
}
function aplicarOlhos(scope) {
    (scope || document).querySelectorAll('input[type="password"]').forEach(injetarOlho);
}

// Aplica máscara automática nos campos de CPF e telefone (por id, mesmo injetados dinamicamente)
const CAMPOS_CPF = ['cpfClienteInput', 'editarClienteCpf'];
const CAMPOS_TEL = ['telClienteInput', 'editarClienteTelefone'];
document.addEventListener('input', (e) => {
    const id = e.target && e.target.id;
    if (!id) return;
    if (CAMPOS_CPF.includes(id)) e.target.value = formatarCPF(e.target.value);
    else if (CAMPOS_TEL.includes(id)) e.target.value = formatarTelefone(e.target.value);
});

// ============================================================
// LEITOR NFC FÍSICO (tipo teclado / HID)
// O leitor "digita" o código do cartão muito rápido e dá Enter.
// Detectamos essa rajada (distinta da digitação humana pela velocidade),
// montamos o UID e emitimos 'nfc_lido' — exatamente como o simulador.
// Funciona em qualquer tela porque está no shared.js.
// ============================================================
(function () {
    let buffer = '';
    let inicio = 0;
    let ultima = 0;
    const RAPIDO = 45;   // ms entre teclas: típico de leitor (humano é bem mais lento)

    document.addEventListener('keydown', (e) => {
        const agora = (window.performance ? performance.now() : Date.now());
        const intervalo = agora - ultima;

        // Intervalo grande => recomeça (era digitação humana / nova leitura)
        if (intervalo > 120) { buffer = ''; inicio = agora; }
        ultima = agora;

        if (e.key === 'Enter') {
            const duracao = agora - inicio;
            // rajada de >=4 caracteres em menos de 700ms = cartão lido
            if (buffer.length >= 4 && duracao < 700) {
                const uid = buffer.trim();
                buffer = '';
                e.preventDefault();
                e.stopPropagation();
                if (typeof socket !== 'undefined' && socket) {
                    socket.emit('nfc_lido', { uid });
                }
            } else {
                buffer = '';
            }
            return;
        }

        if (e.key && e.key.length === 1) {
            buffer += e.key;
            // se está vindo em rajada (leitor), evita "sujar" campos de texto focados
            if (buffer.length >= 2 && intervalo < RAPIDO) {
                e.preventDefault();
            }
        }
    }, true); // fase de captura: intercepta antes dos inputs
})();

// Toast Notification Helper
function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer') || document.body;
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    let icon = 'fa-info-circle';
    if (type === 'success') icon = 'fa-check-circle';
    if (type === 'error') icon = 'fa-exclamation-circle';
    if (type === 'warning') icon = 'fa-exclamation-triangle';
    
    toast.innerHTML = `
        <i class="fa-solid ${icon}"></i>
        <span>${message}</span>
    `;
    container.appendChild(toast);
    
    setTimeout(() => {
        toast.classList.add('fade-out');
        setTimeout(() => toast.remove(), 300);
    }, 3700);
}

// Modal Toggle Handlers
function abrirModalRecarga() {
    recargaNfcAguardando = true;
    nfcCardDetectado = null;
    document.getElementById('recargaNfcStatus').innerText = 'Aguardando cartão NFC...';
    document.getElementById('recargaCardInfo').style.display = 'none';
    document.getElementById('recargaClienteId').value = '';
    document.getElementById('valorRecargaInput').value = '';
    document.getElementById('modalRecarga').classList.add('active');
}

function fecharModalRecarga() {
    recargaNfcAguardando = false;
    document.getElementById('modalRecarga').classList.remove('active');
}

// Toggle dynamic register type sections
async function toggleTipoCadastro(tipo) {
    const secaoNovo = document.getElementById('secaoNovoCliente');
    const secaoExistente = document.getElementById('secaoClienteExistente');
    const secaoSegundaVia = document.getElementById('secaoSegundaVia');
    
    if (tipo === 'novo') {
        if (secaoNovo) secaoNovo.style.display = 'block';
        if (secaoExistente) secaoExistente.style.display = 'none';
        if (secaoSegundaVia) secaoSegundaVia.style.display = 'none';
        
        const nomeInput = document.getElementById('nomeClienteInput');
        if (nomeInput) nomeInput.required = true;
        const selectCliente = document.getElementById('selectClienteExistente');
        if (selectCliente) selectCliente.required = false;
    } else {
        if (secaoNovo) secaoNovo.style.display = 'none';
        if (secaoExistente) secaoExistente.style.display = 'block';
        
        const nomeInput = document.getElementById('nomeClienteInput');
        if (nomeInput) nomeInput.required = false;
        const selectCliente = document.getElementById('selectClienteExistente');
        if (selectCliente) selectCliente.required = true;
        
        await carregarClientesParaCadastro();
        await verificarPrecoSegundaVia();
    }
}

async function carregarClientesParaCadastro() {
    const select = document.getElementById('selectClienteExistente');
    if (!select) return;
    
    try {
        const response = await fetch('/api/clientes');
        if (!response.ok) throw new Error();
        const listaClientes = await response.json();
        
        select.innerHTML = '<option value="">-- Selecione o Cliente --</option>';
        listaClientes.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c.id;
            opt.innerText = `${c.nome} (CPF: ${c.cpf || '—'})`;
            select.appendChild(opt);
        });
    } catch (err) {
        select.innerHTML = '<option value="">Erro ao carregar clientes</option>';
    }
}

async function verificarPrecoSegundaVia() {
    const select = document.getElementById('selectClienteExistente');
    const secaoSegundaVia = document.getElementById('secaoSegundaVia');
    if (!select || !secaoSegundaVia) return;
    
    const clienteId = select.value;
    if (!clienteId) {
        secaoSegundaVia.style.display = 'none';
        return;
    }
    
    try {
        const resCartoes = await fetch(`/api/clientes/${clienteId}/cartoes`);
        if (!resCartoes.ok) throw new Error();
        const list = await resCartoes.json();
        const hasCard = list.length > 0;
        
        if (hasCard) {
            const resConfig = await fetch('/api/config/valor_segunda_via');
            let valor = '10,00';
            if (resConfig.ok) {
                const cfg = await resConfig.json();
                if (cfg && cfg.valor) {
                    valor = parseFloat(cfg.valor).toFixed(2).replace('.', ',');
                }
            }
            document.getElementById('precoSegundaViaTexto').innerText = `R$ ${valor}`;
            secaoSegundaVia.style.display = 'block';
        } else {
            secaoSegundaVia.style.display = 'none';
        }
    } catch (err) {
        console.error('Erro ao verificar segunda via', err);
        secaoSegundaVia.style.display = 'none';
    }
}

function abrirModalCadastro() {
    cadastroNfcAguardando = true;
    nfcCardDetectado = null;
    document.getElementById('cadastroNfcStatus').innerText = 'Aproxime o cartão NFC...';
    document.getElementById('cadastroPerfilInfo').style.display = 'none';
    document.getElementById('formCadastroModal').style.display = 'none';
    
    const uidEl = document.getElementById('cadastroNfcUid');
    if (uidEl) uidEl.value = '';
    const nomeEl = document.getElementById('nomeClienteInput');
    if (nomeEl) nomeEl.value = '';
    const cpfEl = document.getElementById('cpfClienteInput');
    if (cpfEl) cpfEl.value = '';
    const telEl = document.getElementById('telClienteInput');
    if (telEl) telEl.value = '';
    
    const radioNovo = document.querySelector('input[name="tipoCadastro"][value="novo"]');
    if (radioNovo) {
        radioNovo.checked = true;
        toggleTipoCadastro('novo');
    }
    const selectCliente = document.getElementById('selectClienteExistente');
    if (selectCliente) selectCliente.value = '';
    
    document.getElementById('modalCadastro').classList.add('active');
}

function fecharModalCadastro() {
    cadastroNfcAguardando = false;
    document.getElementById('modalCadastro').classList.remove('active');
}

// Submit Recharge Action
async function enviarRecarga(e) {
    if (e) e.preventDefault();
    const clienteId = document.getElementById('recargaClienteId').value;
    const valor = parseFloat(document.getElementById('valorRecargaInput').value);
    
    if (!clienteId || isNaN(valor) || valor <= 0) {
        showToast('Insira um valor e aproxime um cartão NFC válido.', 'error');
        return;
    }
    
    try {
        const response = await fetch(`/api/clientes/${clienteId}/recarga`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ valor, metodo: 'PIX' }) // default value to PIX
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Erro ao realizar recarga');
        
        showToast('Recarga realizada com sucesso!', 'success');
        fecharModalRecarga();
        
        // Trigger page-specific refresh if the function is defined
        if (typeof carregarDadosPagina === 'function') {
            carregarDadosPagina();
        }
    } catch (err) {
        showToast(err.message, 'error');
    }
}

// Submit Quick Recharge on existing client profile inside Cadastro modal
async function enviarRecargaCadastro(e) {
    if (e) e.preventDefault();
    const clienteId = document.getElementById('cadastroPerfilId').value;
    const valor = parseFloat(document.getElementById('valorRecargaCadastroInput').value);
    
    if (!clienteId || isNaN(valor) || valor <= 0) {
        showToast('Insira um valor de recarga válido.', 'error');
        return;
    }
    
    try {
        const response = await fetch(`/api/clientes/${clienteId}/recarga`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ valor, metodo: 'PIX' })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Erro ao realizar recarga');
        
        showToast('Recarga realizada com sucesso!', 'success');
        fecharModalCadastro();
        
        if (typeof carregarDadosPagina === 'function') {
            carregarDadosPagina();
        }
    } catch (err) {
        showToast(err.message, 'error');
    }
}

// Submit Client Registration and NFC Binding Action
async function enviarCadastro(e) {
    if (e) e.preventDefault();
    
    const uid = document.getElementById('cadastroNfcUid').value;
    if (!uid) {
        showToast('Cartão NFC não detectado.', 'error');
        return;
    }
    
    const tipo = document.querySelector('input[name="tipoCadastro"]:checked')?.value || 'novo';
    
    try {
        let clienteId = null;
        let metodo = 'Gratis';
        
        if (tipo === 'novo') {
            const nome = document.getElementById('nomeClienteInput').value.trim();
            const cpf = document.getElementById('cpfClienteInput').value.trim();
            const telEl = document.getElementById('telClienteInput');
            const telefone = telEl ? telEl.value.trim() : '';

            if (!nome) {
                showToast('Nome é obrigatório.', 'error');
                return;
            }
            if (!cpfValido(cpf)) {
                showToast('CPF inválido. Confira os números.', 'error');
                return;
            }
            if (soDigitos(telefone).length < 10) {
                showToast('Informe um telefone válido com DDD.', 'error');
                return;
            }

            // 1. Cadastra o cliente
            const cliResponse = await fetch('/api/clientes', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ nome, cpf, telefone })
            });
            const cliData = await cliResponse.json();
            if (!cliResponse.ok) throw new Error(cliData.error || 'Erro ao cadastrar cliente');
            
            clienteId = cliData.id;
        } else {
            const select = document.getElementById('selectClienteExistente');
            clienteId = select.value;
            if (!clienteId) {
                showToast('Selecione um cliente.', 'error');
                return;
            }
            
            // Verificar se o cliente já possui um cartão (para cobrar 2ª via)
            const secaoSegundaVia = document.getElementById('secaoSegundaVia');
            if (secaoSegundaVia && secaoSegundaVia.style.display !== 'none') {
                metodo = document.getElementById('metodoPagamentoVia').value;
            }
        }
        
        // 2. Vincula o cartão
        const cardResponse = await fetch('/api/cartoes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ uid, clienteId, metodo })
        });
        const cardData = await cardResponse.json();
        if (!cardResponse.ok) throw new Error(cardData.error || 'Erro ao vincular cartão');
        
        showToast('Cartão NFC vinculado com sucesso!', 'success');
        fecharModalCadastro();
        
        if (typeof carregarDadosPagina === 'function') {
            carregarDadosPagina();
        }
    } catch (err) {
        showToast(err.message, 'error');
    }
}

// ============================================================
// CONTROLE DE ACESSO POR PERFIL (admin / atendente)
// Ajusta o menu conforme o perfil e injeta usuário/sair/trocar senha.
// ============================================================
let __me = null;

async function aplicarControleAcesso() {
    try {
        const r = await fetch('/api/me');
        if (!r.ok) return; // sem login válido (o backend já redireciona quando preciso)
        __me = await r.json();
    } catch (e) { return; }
    if (!__me) return;

    const menu = document.querySelector('.sidebar .menu-section');

    if (__me.perfil === 'atendente') {
        // Esconde tudo que não for Atendimento/Caixa
        document.querySelectorAll('.sidebar .menu-item').forEach(a => {
            const href = a.getAttribute('href') || '';
            if (!(href.startsWith('/atendente') || href.startsWith('/caixa'))) a.style.display = 'none';
        });
        document.querySelectorAll('.sidebar .menu-category').forEach(c => c.style.display = 'none');
    } else if (__me.perfil === 'admin' && menu && !menu.querySelector('a[href="/usuarios/"]')) {
        // Injeta o item "Usuários" para o admin
        const cat = document.createElement('div');
        cat.className = 'menu-category';
        cat.textContent = 'Administração';
        const a = document.createElement('a');
        a.href = '/usuarios/';
        a.className = 'menu-item';
        a.innerHTML = '<i class="fa-solid fa-user-gear"></i> Usuários';
        if (location.pathname.startsWith('/usuarios')) a.classList.add('active');
        menu.appendChild(cat);
        menu.appendChild(a);
    }

    // Rodapé com usuário logado + trocar senha + sair (só quando há login real)
    if (!__me.semLogin) injetarRodapeUsuario(__me);
}

function injetarRodapeUsuario(me) {
    const sidebar = document.querySelector('.sidebar');
    if (!sidebar || sidebar.querySelector('.user-footer')) return;
    const rodape = document.createElement('div');
    rodape.className = 'user-footer';
    rodape.innerHTML = `
        <div class="user-info">
            <i class="fa-solid fa-circle-user"></i>
            <div><span class="user-nome">${me.usuario}</span><span class="user-perfil">${me.perfil}</span></div>
        </div>
        <button type="button" class="btn-userf" onclick="abrirTrocarSenha()"><i class="fa-solid fa-key"></i> Trocar senha</button>
        <button type="button" class="btn-userf sair" onclick="sairSistema()"><i class="fa-solid fa-right-from-bracket"></i> Sair</button>
    `;
    sidebar.appendChild(rodape);
}

function sairSistema() {
    fetch('/api/logout', { method: 'POST' }).finally(() => { window.location.href = '/login'; });
}

// ── Modal "Trocar senha" (injetado dinamicamente) ──
function garantirModalTrocarSenha() {
    if (document.getElementById('modalTrocarSenha')) return;
    const div = document.createElement('div');
    div.className = 'modal-overlay';
    div.id = 'modalTrocarSenha';
    div.innerHTML = `
        <div class="modal-container" style="width:380px;">
            <div class="modal-header">
                <h3>Trocar minha senha</h3>
                <button class="btn-close-modal" onclick="fecharTrocarSenha()">&times;</button>
            </div>
            <form id="formTrocarSenha">
                <div class="modal-body">
                    <div class="form-group">
                        <label for="tsAtual">Senha atual</label>
                        <input type="password" id="tsAtual" class="input-control" required>
                    </div>
                    <div class="form-group">
                        <label for="tsNova">Nova senha</label>
                        <input type="password" id="tsNova" class="input-control" required>
                    </div>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary" onclick="fecharTrocarSenha()">Cancelar</button>
                    <button type="submit" class="btn btn-primary"><i class="fa-solid fa-key"></i> Salvar</button>
                </div>
            </form>
        </div>
    `;
    document.body.appendChild(div);
    div.querySelector('#formTrocarSenha').addEventListener('submit', submeterTrocarSenha);
    aplicarOlhos(div); // olhinho nos campos de senha
}

function abrirTrocarSenha() {
    garantirModalTrocarSenha();
    document.getElementById('tsAtual').value = '';
    document.getElementById('tsNova').value = '';
    document.getElementById('modalTrocarSenha').classList.add('active');
}
function fecharTrocarSenha() {
    const m = document.getElementById('modalTrocarSenha');
    if (m) m.classList.remove('active');
}
async function submeterTrocarSenha(e) {
    e.preventDefault();
    const atual = document.getElementById('tsAtual').value;
    const nova = document.getElementById('tsNova').value;
    try {
        const r = await fetch('/api/trocar-senha', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ atual, nova })
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || 'Erro ao trocar senha.');
        showToast('Senha alterada com sucesso!', 'success');
        fecharTrocarSenha();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

// Document Ready Initialization
document.addEventListener('DOMContentLoaded', () => {
    aplicarControleAcesso();
    aplicarOlhos(); // olhinho em todos os campos de senha
    // Inject Theme Toggle Button if topbar-actions exists
    const topbarActions = document.querySelector('.topbar-actions');
    if (topbarActions && !document.getElementById('btnThemeToggle')) {
        const toggleBtn = document.createElement('button');
        toggleBtn.id = 'btnThemeToggle';
        toggleBtn.className = 'btn-theme-toggle';
        toggleBtn.title = 'Alternar Tema (Escuro/Claro)';
        toggleBtn.innerHTML = `
            <i class="fa-solid fa-moon theme-icon-dark"></i>
            <i class="fa-solid fa-sun theme-icon-light"></i>
        `;
        
        // Insert before statusBadge if it exists, otherwise append
        const statusBadge = document.getElementById('statusBadge');
        if (statusBadge) {
            topbarActions.insertBefore(toggleBtn, statusBadge);
        } else {
            topbarActions.appendChild(toggleBtn);
        }
        
        toggleBtn.addEventListener('click', toggleTheme);
    }

    // Set up formCadastroModal structure
    const formCadastroModal = document.getElementById('formCadastroModal');
    if (formCadastroModal) {
        formCadastroModal.innerHTML = `
            <input type="hidden" id="cadastroNfcUid">
            <div class="form-group" style="display: flex; gap: 1.5rem; margin-bottom: 1.2rem; border-bottom: 1px solid rgba(255,255,255,0.08); padding-bottom: 0.8rem;" id="tipoCadastroGrupo">
                <label style="display: flex; align-items: center; gap: 0.4rem; cursor: pointer; font-weight: 500;">
                    <input type="radio" name="tipoCadastro" value="novo" checked style="accent-color: var(--primary);"> Novo Cliente
                </label>
                <label style="display: flex; align-items: center; gap: 0.4rem; cursor: pointer; font-weight: 500;">
                    <input type="radio" name="tipoCadastro" value="existente" style="accent-color: var(--primary);"> Cliente Existente
                </label>
            </div>
            
            <div id="secaoNovoCliente">
                <div class="form-group">
                    <label for="nomeClienteInput">Nome Completo *</label>
                    <input type="text" id="nomeClienteInput" class="input-control" placeholder="Nome do cliente" required>
                </div>
                <div class="form-group">
                    <label for="cpfClienteInput">CPF *</label>
                    <input type="text" id="cpfClienteInput" class="input-control" placeholder="000.000.000-00" inputmode="numeric" maxlength="14" required>
                </div>
                <div class="form-group">
                    <label for="telClienteInput">Telefone *</label>
                    <input type="text" id="telClienteInput" class="input-control" placeholder="(00) 90000-0000" inputmode="numeric" maxlength="15" required>
                </div>
            </div>
            
            <div id="secaoClienteExistente" style="display: none;">
                <div class="form-group">
                    <label for="selectClienteExistente">Selecionar Cliente *</label>
                    <select id="selectClienteExistente" class="input-control">
                        <option value="">Carregando clientes...</option>
                    </select>
                </div>
            </div>
            
            <div id="secaoSegundaVia" style="display: none; margin-top: 1rem; padding: 1rem; border-radius: 8px; background: rgba(201,168,76,0.1); border: 1px solid var(--gold);">
                <div style="display: flex; gap: 0.6rem; align-items: flex-start; margin-bottom: 0.8rem;">
                    <i class="fa-solid fa-circle-info text-gold" style="margin-top: 0.2rem;"></i>
                    <div style="font-size: 0.85rem; color: var(--text-normal); line-height: 1.4;">
                        Este cliente já possui um cartão cadastrado. A vinculação de um novo cartão é considerada uma <strong>2ª Via</strong>.
                        <br>
                        Custo: <strong id="precoSegundaViaTexto">R$ 10,00</strong>.
                    </div>
                </div>
                <div class="form-group" style="margin-bottom: 0;">
                    <label for="metodoPagamentoVia">Forma de Pagamento da 2ª Via</label>
                    <select id="metodoPagamentoVia" class="input-control">
                        <option value="PIX">PIX</option>
                        <option value="Cartao">Cartão de Crédito/Débito</option>
                        <option value="Dinheiro">Dinheiro</option>
                        <option value="Gratis">Cortesia (Grátis)</option>
                    </select>
                </div>
            </div>
            
            <div style="display: flex; justify-content: flex-end; gap: 0.6rem; margin-top: 1.2rem;">
                <button type="button" class="btn btn-secondary btn-cancelar-modal" id="btnCancelarCadastroDynamic">Cancelar</button>
                <button type="submit" class="btn btn-primary" id="btnConfirmarCadastroDynamic">Vincular Cartão</button>
            </div>
        `;
        
        // Add radio button change listeners
        const radioButtons = formCadastroModal.querySelectorAll('input[name="tipoCadastro"]');
        radioButtons.forEach(radio => {
            radio.addEventListener('change', (e) => {
                toggleTipoCadastro(e.target.value);
            });
        });
        
        // Add select cliente change listener
        const selectCliente = formCadastroModal.querySelector('#selectClienteExistente');
        if (selectCliente) {
            selectCliente.addEventListener('change', verificarPrecoSegundaVia);
        }
        
        // Add cancel button click listener
        const cancelBtn = formCadastroModal.querySelector('#btnCancelarCadastroDynamic');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', fecharModalCadastro);
        }
    }

    // Bind Topbar Modals events if buttons exist
    const btnTopRecarregar = document.getElementById('btnTopRecarregar');
    const btnTopCadastrar = document.getElementById('btnTopCadastrar');
    
    if (btnTopRecarregar) btnTopRecarregar.addEventListener('click', abrirModalRecarga);
    if (btnTopCadastrar) btnTopCadastrar.addEventListener('click', abrirModalCadastro);
    
    const closeButtons = document.querySelectorAll('.btn-close-modal, .btn-cancelar-modal');
    closeButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            fecharModalRecarga();
            fecharModalCadastro();
        });
    });
    
    // Form submissions
    const formRecargaModal = document.getElementById('formRecargaModal');
    if (formRecargaModal) formRecargaModal.addEventListener('submit', enviarRecarga);
    
    const formCadastroModalSubmit = document.getElementById('formCadastroModal');
    if (formCadastroModalSubmit) formCadastroModalSubmit.addEventListener('submit', enviarCadastro);

    const formRecargaCadastro = document.getElementById('formRecargaCadastro');
    if (formRecargaCadastro) formRecargaCadastro.addEventListener('submit', enviarRecargaCadastro);
});
