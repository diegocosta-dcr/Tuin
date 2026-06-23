// ============================================================
// Gestão de Usuários — shared.js fornece socket e showToast.
// ============================================================

let usuarios = [];

function esc(t) {
    return String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function dataBR(s) {
    if (!s) return '-';
    try { return new Date(String(s).replace(' ', 'T') + 'Z').toLocaleDateString('pt-BR'); }
    catch (e) { return s; }
}

async function carregarUsuarios() {
    const body = document.getElementById('usuariosBody');
    try {
        const res = await fetch('/api/usuarios');
        if (!res.ok) throw new Error('Sem permissão ou erro ao carregar.');
        usuarios = await res.json();
        renderizar();
    } catch (e) {
        body.innerHTML = `<tr><td colspan="5" class="table-empty">${esc(e.message)}</td></tr>`;
    }
}

function renderizar() {
    const body = document.getElementById('usuariosBody');
    if (!usuarios.length) {
        body.innerHTML = '<tr><td colspan="5" class="table-empty">Nenhum usuário cadastrado.</td></tr>';
        return;
    }
    body.innerHTML = usuarios.map(u => {
        const ativo = u.status === 'ativo';
        const perfilBadge = u.perfil === 'admin'
            ? '<span class="badge-status" style="background:rgba(201,168,76,0.12);color:var(--gold);border:1px solid var(--gold-border);">Admin</span>'
            : '<span class="badge-status" style="background:rgba(76,175,125,0.1);color:var(--success);border:1px solid rgba(76,175,125,0.2);">Atendente</span>';
        const statusBadge = ativo
            ? '<span style="color:var(--success);font-weight:600;">Ativo</span>'
            : '<span style="color:var(--t3);">Inativo</span>';
        const nomeEsc = u.usuario.replace(/'/g, "\\'");
        return `
            <tr>
                <td><strong>${esc(u.usuario)}</strong></td>
                <td>
                    <select class="input-control" style="padding:0.3rem 0.5rem; font-size:0.78rem; width:auto;"
                            onchange="mudarPerfil(${u.id}, this.value)">
                        <option value="atendente" ${u.perfil !== 'admin' ? 'selected' : ''}>Atendente</option>
                        <option value="admin" ${u.perfil === 'admin' ? 'selected' : ''}>Admin</option>
                    </select>
                </td>
                <td>${statusBadge}</td>
                <td style="font-size:0.78rem;">${dataBR(u.criado_em)}</td>
                <td>
                    <div style="display:flex; gap:0.35rem; flex-wrap:wrap;">
                        <button class="btn btn-secondary btn-sm" onclick="abrirNovaSenha(${u.id}, '${nomeEsc}')" title="Definir nova senha">
                            <i class="fa-solid fa-key"></i>
                        </button>
                        <button class="btn btn-secondary btn-sm" onclick="toggleStatus(${u.id}, '${u.status}')" title="${ativo ? 'Desativar' : 'Ativar'}">
                            <i class="fa-solid ${ativo ? 'fa-ban' : 'fa-check'}"></i>
                        </button>
                        <button class="btn btn-secondary btn-sm" style="color:var(--error); border-color:rgba(212,80,80,0.25);" onclick="excluirUsuario(${u.id}, '${nomeEsc}')" title="Excluir">
                            <i class="fa-solid fa-trash"></i>
                        </button>
                    </div>
                </td>
            </tr>`;
    }).join('');
}

// ── Novo usuário ──
function abrirNovo() {
    document.getElementById('formNovoUsuario').reset();
    document.getElementById('modalNovoUsuario').classList.add('active');
}
function fecharNovo() { document.getElementById('modalNovoUsuario').classList.remove('active'); }

async function submeterNovo(e) {
    e.preventDefault();
    const usuario = document.getElementById('novoUsuario').value.trim();
    const senha = document.getElementById('novoSenha').value;
    const perfil = document.getElementById('novoPerfil').value;
    if (!usuario || !senha) { showToast('Preencha usuário e senha.', 'error'); return; }
    try {
        const res = await fetch('/api/usuarios', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ usuario, senha, perfil })
        });
        const d = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(d.error || 'Erro ao criar usuário.');
        showToast('Usuário criado!', 'success');
        fecharNovo();
        carregarUsuarios();
    } catch (err) { showToast(err.message, 'error'); }
}

// ── Mudar perfil / status ──
async function mudarPerfil(id, perfil) {
    try {
        const res = await fetch(`/api/usuarios/${id}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ perfil })
        });
        if (!res.ok) throw new Error();
        showToast('Perfil atualizado.', 'success');
    } catch (e) { showToast('Erro ao atualizar perfil.', 'error'); carregarUsuarios(); }
}

async function toggleStatus(id, statusAtual) {
    const novo = statusAtual === 'ativo' ? 'inativo' : 'ativo';
    try {
        const res = await fetch(`/api/usuarios/${id}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: novo })
        });
        if (!res.ok) throw new Error();
        showToast(novo === 'ativo' ? 'Usuário ativado.' : 'Usuário desativado.', 'success');
        carregarUsuarios();
    } catch (e) { showToast('Erro ao alterar situação.', 'error'); }
}

// ── Nova senha ──
function abrirNovaSenha(id, nome) {
    document.getElementById('senhaUsuarioId').value = id;
    document.getElementById('senhaUsuarioNome').innerText = nome;
    document.getElementById('senhaNovaValor').value = '';
    document.getElementById('modalNovaSenha').classList.add('active');
}
function fecharNovaSenha() { document.getElementById('modalNovaSenha').classList.remove('active'); }

async function submeterNovaSenha(e) {
    e.preventDefault();
    const id = document.getElementById('senhaUsuarioId').value;
    const senha = document.getElementById('senhaNovaValor').value;
    if (!senha) { showToast('Informe a nova senha.', 'error'); return; }
    try {
        const res = await fetch(`/api/usuarios/${id}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ senha })
        });
        if (!res.ok) throw new Error();
        showToast('Senha redefinida!', 'success');
        fecharNovaSenha();
    } catch (e) { showToast('Erro ao redefinir senha.', 'error'); }
}

// ── Excluir ──
async function excluirUsuario(id, nome) {
    if (!confirm(`Excluir o usuário "${nome}"?`)) return;
    try {
        const res = await fetch(`/api/usuarios/${id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error();
        showToast('Usuário excluído.', 'success');
        carregarUsuarios();
    } catch (e) { showToast('Erro ao excluir.', 'error'); }
}

document.addEventListener('DOMContentLoaded', () => {
    carregarUsuarios();
    document.getElementById('btnNovoUsuario').addEventListener('click', abrirNovo);
    document.getElementById('btnFecharNovo').addEventListener('click', fecharNovo);
    document.getElementById('btnCancelarNovo').addEventListener('click', fecharNovo);
    document.getElementById('formNovoUsuario').addEventListener('submit', submeterNovo);
    document.getElementById('btnFecharSenha').addEventListener('click', fecharNovaSenha);
    document.getElementById('btnCancelarSenha').addEventListener('click', fecharNovaSenha);
    document.getElementById('formNovaSenha').addEventListener('submit', submeterNovaSenha);
});
