// Relatórios controller script

let consumoChart = null;

async function carregarDadosPagina() {
    try {
        const res = await fetch('/api/relatorios/painel');
        if (!res.ok) throw new Error();
        const data = await res.json();

        renderizarTabelaDetalhes(data.consumoTorneiras);
        renderizarGrafico(data.consumoTorneiras);
    } catch (err) {
        showToast('Erro ao carregar dados dos relatórios.', 'error');
    }
}

function renderizarTabelaDetalhes(consumos) {
    const body = document.getElementById('tapsStatsBody');
    if (!body) return;

    body.innerHTML = '';
    if (!consumos || consumos.length === 0) {
        body.innerHTML = `
            <tr>
                <td colspan="4" class="table-empty">Nenhum consumo registrado ainda.</td>
            </tr>
        `;
        return;
    }

    // Sort by tap number
    consumos.sort((a, b) => a.numero - b.numero).forEach(c => {
        const tr = document.createElement('tr');
        const copos = c.qtd_copos || 0;
        tr.innerHTML = `
            <td><strong>Torneira #${c.numero}</strong></td>
            <td>${c.chopp_nome}</td>
            <td>${copos} ${copos === 1 ? 'copo' : 'copos'}</td>
            <td style="color: var(--primary); font-weight: 600;">R$ ${(c.valor_total || 0).toFixed(2)}</td>
        `;
        body.appendChild(tr);
    });
}

function renderizarGrafico(consumos) {
    const ctx = document.getElementById('chartConsumo');
    if (!ctx) return;

    // Sort by tap number
    consumos.sort((a, b) => a.numero - b.numero);

    const labels = consumos.map(c => `Torneira #${c.numero} (${c.chopp_nome})`);
    const dataValues = consumos.map(c => c.qtd_copos || 0); // copos servidos

    if (consumoChart) {
        consumoChart.destroy();
    }

    consumoChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Copos servidos',
                data: dataValues,
                backgroundColor: 'rgba(201, 168, 76, 0.4)',
                borderColor: 'rgba(201, 168, 76, 1)',
                borderWidth: 1.5,
                borderRadius: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    labels: {
                        color: '#FFFFFF',
                        font: { family: 'Poppins', size: 12 }
                    }
                }
            },
            scales: {
                x: {
                    grid: { color: 'rgba(255, 255, 255, 0.04)' },
                    ticks: {
                        color: '#888888',
                        font: { family: 'Poppins', size: 10 }
                    }
                },
                y: {
                    grid: { color: 'rgba(255, 255, 255, 0.04)' },
                    ticks: {
                        color: '#888888',
                        font: { family: 'Poppins', size: 10 }
                    },
                    suggestedMin: 0
                }
            }
        }
    });
}

socket.on('relatorios_atualizado', () => {
    carregarDadosPagina();
});

document.addEventListener('DOMContentLoaded', () => {
    carregarDadosPagina();
});
