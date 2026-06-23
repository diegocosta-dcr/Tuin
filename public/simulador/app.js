// Conexão com o Socket.io
const socket = io();

// Estados da máquina de simulação
let torneiras = [];
let cartoes = [];
let sessaoAtiva = null;
let torneiraSelecionada = null;
let cartaoUidSelecionado = null;

// Parâmetros de consumo
let mlAcumulado = 0;
let custoAcumulado = 0;
let saldoInicialCliente = 0;
let saldoAtualCliente = 0;
let precoChoppPorMl = 0;
let choppNomeAtivo = '';
let clienteNomeAtivo = '';

// Intervalos de tempo para fluxo de chopp
let flowInterval = null;
let apiUpdateCounter = 0;
let isPouring = false;

// Elementos do DOM
const statusIndicator = document.getElementById('statusIndicator');
const statusText = document.getElementById('statusText');
const selectTorneira = document.getElementById('selectTorneira');
const selectCartaoPredefinido = document.getElementById('selectCartaoPredefinido');
const inputUidCustom = document.getElementById('inputUidCustom');
const btnAproximarNfc = document.getElementById('btnAproximarNfc');
const terminalLogs = document.getElementById('terminalLogs');
const btnClearLogs = document.getElementById('btnClearLogs');

// Elementos Físicos Simulado
const valveLed = document.getElementById('valveLed');
const valveStatusText = document.getElementById('valveStatusText');
const tapNozzle = document.querySelector('.tap-nozzle');
const tapHandle = document.getElementById('tapHandle');
const beerStream = document.getElementById('beerStream');
const beerLiquid = document.getElementById('beerLiquid');
const beerFoam = document.getElementById('beerFoam');

// Displays LCD
const lcdTitle = document.getElementById('lcdTitle');
const lcdStateAguardando = document.getElementById('lcdStateAguardando');
const lcdStateLiberado = document.getElementById('lcdStateLiberado');
const lcdStateErro = document.getElementById('lcdStateErro');
const lcdClienteNome = document.getElementById('lcdClienteNome');
const lcdChoppNome = document.getElementById('lcdChoppNome');
const lcdVolume = document.getElementById('lcdVolume');
const lcdCusto = document.getElementById('lcdCusto');
const lcdSaldoCliente = document.getElementById('lcdSaldoCliente');
const lcdErrorMsg = document.getElementById('lcdErrorMsg');

// Botões de Hardware
const btnServirChopp = document.getElementById('btnServirChopp');
const btnFecharTorneira = document.getElementById('btnFecharTorneira');

// Notificações Toast
function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
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

// Log no console interno do simulador
function addLog(message, type = 'info') {
    const time = new Date().toLocaleTimeString();
    const logLine = document.createElement('div');
    logLine.className = `log-line text-${type}`;
    logLine.textContent = `[${time}] ${message}`;
    terminalLogs.appendChild(logLine);
    terminalLogs.scrollTop = terminalLogs.scrollHeight;
}

// Status de conexão
socket.on('connect', () => {
    statusIndicator.className = 'status-indicator online';
    statusText.innerText = 'Hardware Conectado';
    addLog('Conectado ao servidor Websocket.', 'success');
});

socket.on('disconnect', () => {
    statusIndicator.className = 'status-indicator offline';
    statusText.innerText = 'Hardware Desconectado';
    addLog('Conexão com servidor perdida!', 'error');
});

// Inicialização
document.addEventListener('DOMContentLoaded', () => {
    carregarHardwareInfo();
    
    btnAproximarNfc.addEventListener('click', aproximarCartaoNfc);
    btnClearLogs.addEventListener('click', () => {
        terminalLogs.innerHTML = '';
        addLog('Console limpo.', 'muted');
    });

    // Eventos de Pressionar para Servir (Mouse e Touch)
    btnServirChopp.addEventListener('mousedown', iniciarFluxoChopp);
    btnServirChopp.addEventListener('touchstart', (e) => {
        e.preventDefault();
        iniciarFluxoChopp();
    });

    window.addEventListener('mouseup', pararFluxoChopp);
    window.addEventListener('touchend', pararFluxoChopp);
    
    btnFecharTorneira.addEventListener('click', finalizarConsumoManual);

    // Atualização de dados vinda do servidor
    socket.on('clientes_atualizado', carregarHardwareInfo);
    socket.on('cartoes_atualizado', carregarHardwareInfo);
    socket.on('torneiras_atualizado', carregarHardwareInfo);
});

// Carregar torneiras e cartões para o formulário
async function carregarHardwareInfo() {
    try {
        // Torneiras
        const resTorneiras = await fetch('/api/torneiras');
        if (resTorneiras.ok) {
            torneiras = await resTorneiras.ok ? await resTorneiras.json() : [];
            const selectVal = selectTorneira.value;
            selectTorneira.innerHTML = '';
            torneiras.forEach(t => {
                const opt = document.createElement('option');
                opt.value = t.numero;
                opt.textContent = `Torneira #${t.numero} - ${t.chopp_nome} (R$ ${t.chopp_preco_litro.toFixed(2)}/L)`;
                if (t.status !== 'ativa') {
                    opt.textContent += ' [MANUTENÇÃO]';
                    opt.disabled = true;
                }
                selectTorneira.appendChild(opt);
            });
            if (selectVal) selectTorneira.value = selectVal;
        }

        // Cartões
        const resCartoes = await fetch('/api/cartoes');
        if (resCartoes.ok) {
            cartoes = await resCartoes.json();
            const selectCardVal = selectCartaoPredefinido.value;
            selectCartaoPredefinido.innerHTML = '<option value="">Selecione um cartão...</option>';
            cartoes.forEach(c => {
                if (c.status === 'ativo') {
                    const opt = document.createElement('option');
                    opt.value = c.uid;
                    opt.textContent = `${c.uid} - ${c.cliente_nome} (Saldo: R$ ${parseFloat(c.cliente_saldo).toFixed(2)})`;
                    selectCartaoPredefinido.appendChild(opt);
                }
            });
            if (selectCardVal) selectCartaoPredefinido.value = selectCardVal;
        }
    } catch (error) {
        addLog('Erro ao carregar informações das torneiras/cartões.', 'error');
    }
}

// Mostrar determinado estado no LCD
function setLcdState(state, errorMsg = '') {
    lcdStateAguardando.classList.remove('active');
    lcdStateLiberado.classList.remove('active');
    lcdStateErro.classList.remove('active');

    if (state === 'aguardando') {
        lcdStateAguardando.classList.add('active');
        lcdTitle.innerText = 'TUIN CHOPP SELF-SERVICE';
    } else if (state === 'liberado') {
        lcdStateLiberado.classList.add('active');
        lcdTitle.innerText = `TORNEIRA #${selectTorneira.value} ATIVA`;
    } else if (state === 'erro') {
        lcdStateErro.classList.add('active');
        lcdTitle.innerText = 'ERRO DE SISTEMA';
        lcdErrorMsg.innerText = errorMsg;
    }
}

// Alterar visual do LED
function setLedState(state) {
    valveLed.className = 'valve-led';
    if (state === 'vermelho') {
        valveLed.classList.add('led-red');
        valveStatusText.innerText = 'BLOQUEADA (FECHADA)';
        valveStatusText.style.color = 'var(--primary-red)';
    } else if (state === 'verde') {
        valveLed.classList.add('led-green');
        valveStatusText.innerText = 'LIBERADA (ABERTA)';
        valveStatusText.style.color = 'var(--primary-green)';
    } else if (state === 'amarelo') {
        valveLed.classList.add('led-yellow');
        valveStatusText.innerText = 'AGUARDANDO CARTÃO';
        valveStatusText.style.color = 'var(--accent-lime)';
    }
}

// Aproximar Cartão NFC
async function aproximarCartaoNfc() {
    const uid = inputUidCustom.value.trim() || selectCartaoPredefinido.value;
    const torneiraNumero = selectTorneira.value;

    if (!uid) {
        showToast('Selecione ou insira um UID de cartão.', 'warning');
        return;
    }

    if (!torneiraNumero) {
        showToast('Nenhuma torneira selecionada.', 'warning');
        return;
    }

    addLog(`Aproximando cartão NFC (UID: ${uid}) na torneira #${torneiraNumero}...`, 'info');

    // Emite o sinal para que o painel do atendente consiga capturar o UID se estiver no modo de detecção
    socket.emit('nfc_lido', { uid });

    try {
        const response = await fetch('/api/hardware/aproximar-cartao', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ uid, torneiraNumero })
        });

        const data = await response.json();

        if (!response.ok || data.status === 'negado') {
            const errorText = data.error || 'Cartão inválido ou sem saldo';
            addLog(`Acesso negado: ${errorText}`, 'error');
            setLcdState('erro', errorText.toUpperCase());
            setLedState('vermelho');
            
            // Apita/Pisca vermelho e depois volta para amarelo
            setTimeout(() => {
                if (!sessaoAtiva) {
                    setLcdState('aguardando');
                    setLedState('amarelo');
                }
            }, 3000);
            return;
        }

        // Sucesso na liberação
        sessaoAtiva = data.sessaoId;
        saldoInicialCliente = data.cliente.saldo;
        saldoAtualCliente = data.cliente.saldo;
        precoChoppPorMl = data.torneira.chopp_preco_litro / 1000.0;
        choppNomeAtivo = data.torneira.chopp_nome;
        clienteNomeAtivo = data.cliente.nome;

        mlAcumulado = 0;
        custoAcumulado = 0;

        addLog(`Acesso Autorizado! Cliente: ${clienteNomeAtivo} | Saldo: R$ ${saldoInicialCliente.toFixed(2)}`, 'success');
        addLog(`Torneira #${torneiraNumero} liberada para o chopp ${choppNomeAtivo}.`, 'success');
        
        // Atualiza LCD
        lcdClienteNome.innerText = clienteNomeAtivo;
        lcdChoppNome.innerText = choppNomeAtivo;
        lcdVolume.innerHTML = `0.0 <span class="unit">ml</span>`;
        lcdCusto.innerText = `R$ 0.00`;
        lcdSaldoCliente.innerText = `R$ ${saldoInicialCliente.toFixed(2)}`;

        setLcdState('liberado');
        setLedState('verde');

        // Reseta Copo visual
        beerLiquid.style.height = '0%';
        beerFoam.style.bottom = '0%';
        beerFoam.style.height = '0px';

        // Ativa botões
        btnServirChopp.disabled = false;
        btnFecharTorneira.disabled = false;
    } catch (error) {
        addLog(`Erro de comunicação com o servidor: ${error.message}`, 'error');
    }
}

// Iniciar o Fluxo do Chopp (Segurar botão)
function iniciarFluxoChopp() {
    if (!sessaoAtiva || isPouring) return;
    
    isPouring = true;
    tapNozzle.classList.add('active');
    document.querySelector('.pouring-area').classList.add('pouring-active');
    addLog('Torneira aberta. Chopp fluindo...', 'info');

    flowInterval = setInterval(async () => {
        // Simula vazão (aprox. 6.5ml a cada 100ms)
        const mlVazao = 6.5;
        mlAcumulado = parseFloat((mlAcumulado + mlVazao).toFixed(1));
        custoAcumulado = parseFloat((mlAcumulado * precoChoppPorMl).toFixed(4));

        saldoAtualCliente = parseFloat((saldoInicialCliente - custoAcumulado).toFixed(2));

        // Atualiza Display LCD em Tempo Real (Simulação local imediata)
        lcdVolume.innerHTML = `${mlAcumulado.toFixed(1)} <span class="unit">ml</span>`;
        lcdCusto.innerText = `R$ ${custoAcumulado.toFixed(2)}`;
        lcdSaldoCliente.innerText = `R$ ${Math.max(0, saldoAtualCliente).toFixed(2)}`;

        // Atualiza visual do copo (capacidade de 400ml = 100%)
        const percCopo = Math.min(100, (mlAcumulado / 400) * 100);
        beerLiquid.style.height = `${percCopo}%`;
        beerFoam.style.bottom = `${percCopo}%`;
        beerFoam.style.height = percCopo > 0 ? '8px' : '0px';

        // Contador para mandar atualização de fluxo para a API a cada 500ms (5 * 100ms)
        apiUpdateCounter++;
        if (apiUpdateCounter >= 5) {
            apiUpdateCounter = 0;
            await enviarAtualizacaoFluxo();
        }
    }, 100);
}

// Enviar vazão para o Backend
async function enviarAtualizacaoFluxo() {
    if (!sessaoAtiva) return;

    try {
        const response = await fetch('/api/hardware/atualizar-fluxo', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sessaoId: sessaoAtiva,
                mlConsumido: mlAcumulado
            })
        });

        const data = await response.json();

        // Se o servidor bloquear (ex: saldo esgotado)
        if (data.status === 'bloqueado') {
            mlAcumulado = data.mlConsumido;
            custoAcumulado = data.custo;
            saldoAtualCliente = 0;

            addLog('Válvula fechada automaticamente pelo servidor: SALDO ZERADO.', 'error');
            pararFluxoChopp();
            bloquearPorSaldoEsgotado();
        }
    } catch (error) {
        console.error('Erro ao enviar fluxo:', error);
    }
}

// Parar o Fluxo (Soltar botão)
function pararFluxoChopp() {
    if (!isPouring) return;
    
    isPouring = false;
    if (flowInterval) {
        clearInterval(flowInterval);
        flowInterval = null;
    }
    
    tapNozzle.classList.remove('active');
    document.querySelector('.pouring-area').classList.remove('pouring-active');
    addLog(`Torneira fechada temporariamente. Servido: ${mlAcumulado.toFixed(1)} ml.`, 'info');
    
    // Manda a atualização final instantânea
    enviarAtualizacaoFluxo();
}

// Bloqueio por saldo esgotado
function bloquearPorSaldoEsgotado() {
    sessaoAtiva = null;
    
    // LCD Erro
    setLcdState('erro', 'SALDO ESGOTADO');
    setLedState('vermelho');

    // Desativa botões
    btnServirChopp.disabled = true;
    btnFecharTorneira.disabled = true;

    // Atualiza listas locais
    carregarHardwareInfo();
    showToast('Consumo encerrado: Seu saldo acabou.', 'error');

    setTimeout(() => {
        setLcdState('aguardando');
        setLedState('amarelo');
        // Reseta Copo visual
        beerLiquid.style.height = '0%';
        beerFoam.style.bottom = '0%';
        beerFoam.style.height = '0px';
    }, 5000);
}

// Finalizar consumo voluntariamente (Copo cheio)
async function finalizarConsumoManual() {
    if (!sessaoAtiva) return;

    pararFluxoChopp();
    addLog('Finalizando sessão de consumo e fechando torneira...', 'info');

    try {
        const response = await fetch('/api/hardware/fechar-torneira', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessaoId: sessaoAtiva })
        });

        if (response.ok) {
            addLog(`Sessão finalizada com sucesso! Total servido: ${mlAcumulado.toFixed(1)}ml | Valor pago: R$ ${custoAcumulado.toFixed(2)}`, 'success');
            showToast('Consumo finalizado. Obrigado!', 'success');
        } else {
            addLog('Erro ao fechar sessão no servidor.', 'error');
        }
    } catch (error) {
        addLog(`Erro de rede ao finalizar: ${error.message}`, 'error');
    } finally {
        sessaoAtiva = null;
        
        // Retorna ao estado de aguardo
        setLcdState('aguardando');
        setLedState('amarelo');

        // Desativa botões
        btnServirChopp.disabled = true;
        btnFecharTorneira.disabled = true;

        // Atualiza listas do hardware (ex: saldos nos dropdowns)
        carregarHardwareInfo();
    }
}
