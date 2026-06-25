// Produtos (catálogo) — vinho, petiscos, comidas, bebidas
// socket e showToast vêm do /shared.js (NÃO redeclarar).

let produtos = [];
let excluindoId = null;

function formatarReal(valor) {
    return 'R$ ' + (parseFloat(valor) || 0).toFixed(2).replace('.', ',');
}

function escaparHtml(txt) {
    return String(txt ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ── Carregar catálogo ──
async function carregarProdutos() {
    const body = document.getElementById('produtosTableBody');
    try {
        const res = await fetch('/api/produtos');
        if (!res.ok) throw new Error('Erro ao carregar produtos');
        produtos = await res.json();

        // datalist de categorias existentes (ajuda no cadastro)
        const cats = [...new Set(produtos.map(p => p.categoria).filter(Boolean))];
        document.getElementById('categoriasList').innerHTML =
            cats.map(c => `<option value="${escaparHtml(c)}">`).join('');

        if (!produtos.length) {
            body.innerHTML = '<tr><td colspan="5" class="table-empty">Nenhum produto cadastrado ainda.</td></tr>';
            return;
        }

        body.innerHTML = produtos.map(p => {
            const inativo = p.status === 'inativo';
            const statusBadge = inativo
                ? '<span class="badge-off">Inativo</span>'
                : '<span class="badge-on">Ativo</span>';
            return `
            <tr class="${inativo ? 'linha-inativa' : ''}">
                <td><strong>${escaparHtml(p.nome)}</strong></td>
                <td>${escaparHtml(p.categoria || '—')}</td>
                <td class="col-preco">${formatarReal(p.preco)}</td>
                <td>${statusBadge}</td>
                <td class="cell-acoes">
                    <button class="btn-icone" title="${inativo ? 'Ativar' : 'Desativar'}" data-acao="toggle" data-id="${p.id}">
                        <i class="fa-solid ${inativo ? 'fa-eye' : 'fa-eye-slash'}"></i>
                    </button>
                    <button class="btn-icone" title="Editar" data-acao="editar" data-id="${p.id}">
                        <i class="fa-solid fa-pen"></i>
                    </button>
                    <button class="btn-icone btn-icone-danger" title="Excluir" data-acao="excluir" data-id="${p.id}">
                        <i class="fa-solid fa-trash-can"></i>
                    </button>
                </td>
            </tr>`;
        }).join('');
    } catch (err) {
        body.innerHTML = '<tr><td colspan="5" class="table-empty">Erro ao carregar produtos.</td></tr>';
        showToast(err.message, 'error');
    }
}

// ── Modal novo/editar ──
function abrirModalProduto(produto) {
    document.getElementById('produtoId').value = produto ? produto.id : '';
    document.getElementById('produtoNome').value = produto ? produto.nome : '';
    document.getElementById('produtoCategoria').value = produto ? (produto.categoria || '') : '';
    document.getElementById('produtoPreco').value = produto ? produto.preco : '';
    document.getElementById('modalProdutoTitulo').textContent = produto ? 'Editar produto' : 'Novo produto';
    document.getElementById('modalProduto').classList.add('active');
    document.getElementById('produtoNome').focus();
}

function fecharModalProduto() {
    document.getElementById('modalProduto').classList.remove('active');
}

async function salvarProduto() {
    const id = document.getElementById('produtoId').value;
    const nome = document.getElementById('produtoNome').value.trim();
    const categoria = document.getElementById('produtoCategoria').value.trim();
    const preco = parseFloat(document.getElementById('produtoPreco').value);

    if (!nome) { showToast('Informe o nome do produto.', 'error'); return; }
    if (isNaN(preco) || preco < 0) { showToast('Informe um preço válido.', 'error'); return; }

    const btn = document.getElementById('btnSalvarProduto');
    btn.disabled = true;
    try {
        const url = id ? `/api/produtos/${id}` : '/api/produtos';
        const metodo = id ? 'PUT' : 'POST';
        const res = await fetch(url, {
            method: metodo,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nome, categoria, preco })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Erro ao salvar produto');
        showToast(id ? 'Produto atualizado.' : 'Produto cadastrado.', 'success');
        fecharModalProduto();
        carregarProdutos();
    } catch (err) {
        showToast(err.message, 'error');
    } finally {
        btn.disabled = false;
    }
}

// ── Ativar / desativar ──
async function alternarStatus(id) {
    const p = produtos.find(x => String(x.id) === String(id));
    if (!p) return;
    const novo = p.status === 'inativo' ? 'ativo' : 'inativo';
    try {
        const res = await fetch(`/api/produtos/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: novo })
        });
        if (!res.ok) throw new Error('Erro ao alterar status');
        showToast(novo === 'ativo' ? 'Produto ativado.' : 'Produto desativado.', 'success');
        carregarProdutos();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

// ── Excluir ──
function abrirModalExcluir(id) {
    const p = produtos.find(x => String(x.id) === String(id));
    if (!p) return;
    excluindoId = id;
    document.getElementById('excluirNome').textContent = p.nome;
    document.getElementById('modalExcluir').classList.add('active');
}

function fecharModalExcluir() {
    document.getElementById('modalExcluir').classList.remove('active');
    excluindoId = null;
}

async function confirmarExcluir() {
    if (!excluindoId) return;
    const btn = document.getElementById('btnConfirmarExcluir');
    btn.disabled = true;
    try {
        const res = await fetch(`/api/produtos/${excluindoId}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('Erro ao excluir produto');
        showToast('Produto excluído.', 'success');
        fecharModalExcluir();
        carregarProdutos();
    } catch (err) {
        showToast(err.message, 'error');
    } finally {
        btn.disabled = false;
    }
}

// ── Init ──
document.addEventListener('DOMContentLoaded', () => {
    carregarProdutos();

    document.getElementById('btnNovoProduto').addEventListener('click', () => abrirModalProduto(null));
    document.getElementById('btnFecharModalProduto').addEventListener('click', fecharModalProduto);
    document.getElementById('btnCancelarProduto').addEventListener('click', fecharModalProduto);
    document.getElementById('btnSalvarProduto').addEventListener('click', salvarProduto);

    document.getElementById('btnFecharModalExcluir').addEventListener('click', fecharModalExcluir);
    document.getElementById('btnCancelarExcluir').addEventListener('click', fecharModalExcluir);
    document.getElementById('btnConfirmarExcluir').addEventListener('click', confirmarExcluir);

    // Delegação de ações na tabela
    document.getElementById('produtosTableBody').addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-acao]');
        if (!btn) return;
        const id = btn.dataset.id;
        const acao = btn.dataset.acao;
        if (acao === 'editar') abrirModalProduto(produtos.find(x => String(x.id) === String(id)));
        else if (acao === 'toggle') alternarStatus(id);
        else if (acao === 'excluir') abrirModalExcluir(id);
    });

    // Enter no preço salva
    document.getElementById('produtoPreco').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') salvarProduto();
    });

    // Fechar modais clicando fora
    document.getElementById('modalProduto').addEventListener('click', (e) => {
        if (e.target.id === 'modalProduto') fecharModalProduto();
    });
    document.getElementById('modalExcluir').addEventListener('click', (e) => {
        if (e.target.id === 'modalExcluir') fecharModalExcluir();
    });

    // Tempo real
    socket.on('produtos_atualizado', carregarProdutos);
});
