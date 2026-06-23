# TUIN - Autoatendimento de Chopp via Cartão NFC

Este é um sistema completo e interativo de autoatendimento para chopes utilizando cartões NFC. O projeto conta com um backend robusto em Node.js com Express e SQLite para banco de dados local, além de interfaces web dinâmicas em HTML5, CSS3 e JavaScript Vanilla com suporte a atualização em tempo real via Websockets (Socket.io).

## 🚀 Como Rodar o Sistema

### Pré-requisitos
Para executar o sistema, você precisa ter instalado em sua máquina:
1. **Node.js** (Versão 16 ou superior recomendada)
2. **NPM** (Gerenciador de pacotes que acompanha o Node)

Se você não os tem instalados, baixe e instale a partir do site oficial: [https://nodejs.org/](https://nodejs.org/)

---

### Passo 1: Instalar Dependências
Abra o terminal na pasta `TUIN` e execute o comando abaixo para instalar as bibliotecas necessárias (`express`, `socket.io`, `sqlite3` e `cors`):
```bash
npm install
```

### Passo 2: Iniciar o Servidor
Com as dependências instaladas, inicialize o servidor com o comando:
```bash
npm start
```
Você verá uma mensagem informando que o servidor está rodando:
> `Servidor rodando na porta 3000`  
> `Acesse o portal do autoatendimento em http://localhost:3000`

---

## 🖥️ Módulos do Sistema (URLs de Acesso)

Ao iniciar o servidor, abra o seu navegador e acesse a página inicial:
* 🏠 **Portal de Entrada:** `http://localhost:3000`

A partir do portal, você poderá acessar os três painéis desenvolvidos:
1. 📊 **Painel de Gestão:** `http://localhost:3000/dashboard/`  
   *Monitora torneiras ativas em tempo real, mostra gráficos de consumo por torneira (litros), exibe histórico de consumo, controle de KPIs de faturamento e permite cadastrar e editar torneiras.*
2. 👥 **Painel do Atendente:** `http://localhost:3000/atendente/`  
   *Permite cadastrar novos clientes, associar cartões NFC com UIDs escaneados e realizar recarga rápida de saldo com botões de atalho ($10, $20, $50, $100).*
3. 🎮 **Simulador de Torneira NFC:** `http://localhost:3000/simulador/`  
   *Uma simulação visual rica de uma torneira física e leitor NFC. Permite selecionar torneiras, simular a aproximação de cartões cadastrados e ver o chopp enchendo o copo com foam em tempo real enquanto debita o saldo de forma fracionada.*

---

## 🧪 Guia de Teste Passo a Passo (Simulação de Hardware)

Para testar o funcionamento completo de ponta a ponta sem o hardware físico:

1. **Abra três abas no seu navegador:**
   * Uma no **Painel do Atendente** (`/atendente`)
   * Outra no **Simulador de Torneira** (`/simulador`)
   * Outra no **Painel de Gestão** (`/dashboard`)
2. **Cadastre um Cliente e Adicione Saldo:**
   * No **Painel do Atendente**, adicione um novo cliente (exemplo: `Diego`).
   * Clique em **"Detectar"** ao lado do campo UID no formulário de cartões NFC. O botão mudará para *"Aguardando..."*.
   * Vá até o **Simulador de Torneira**, digite um UID (ex: `NFC777`) no campo *"Ou digite um UID NFC manual"* e clique em **"Aproximar Cartão NFC"**. O simulador dirá que o cartão foi negado (pois ainda não foi vinculado), mas ele transmitirá o UID.
   * Volte ao **Painel do Atendente**. O campo de UID do cartão estará preenchido automaticamente com `NFC777`! Selecione o cliente `Diego` no dropdown e clique em **"Vincular Cartão"**.
   * Na tabela de clientes cadastrados, localize o Diego, clique em **"Recarregar"**, selecione o valor (ex: `R$ 50.00`), o método de pagamento (ex: `PIX`) e confirme a recarga.
3. **Sirva o Chopp (Simulador):**
   * Vá para o **Simulador de Torneira**. Agora selecione o cartão `NFC777` (ou digite-o de forma manual) e a torneira desejada. Clique em **"Aproximar Cartão NFC"**.
   * O display LCD digital do simulador mudará para **"LIBERADO"**, o LED ficará **Verde** e mostrará o nome do Diego e o saldo de R$ 50,00.
   * **Pressione e segure** o botão verde **"Mantenha Pressionado para Servir"**. Você verá a alavanca da torneira se mover, o líquido dourado fluindo e o copo se enchendo de chopp com espuma. O LCD mostrará os ml consumidos subindo e o saldo do Diego diminuindo proporcionalmente em tempo real.
   * Se você soltar o botão de servir, o fluxo pausa temporariamente.
   * Se você segurar o botão até o saldo chegar a R$ 0,00, a válvula fechará sozinha imediatamente, o LED ficará vermelho, a vazão será interrompida e o LCD exibirá **"SALDO ESGOTADO"**.
   * Caso queira finalizar antes do saldo zerar, clique no botão cinza **"Finalizar Consumo"** para fechar a sessão.
4. **Verifique no Painel de Gestão:**
   * No **Painel de Gestão**, observe os gráficos de Litros Consumidos atualizarem, os valores dos KPIs de faturamento e volume subirem e o consumo ficar registrado na tabela de histórico de transações.
   * Se você estiver com a tela do Gestão aberta lado a lado enquanto serve no simulador, verá o card da torneira piscar em **"servindo"** e a contagem de ml aumentar em tempo real!

---

## 📁 Estrutura de Pastas do Projeto

* `server.js` - Servidor principal (Rotas REST + Socket.io + Lógica de faturamento).
* `database.js` - Gerenciador do banco SQLite e tabela de Seeds iniciais.
* `tuin.db` - Arquivo de banco de dados SQLite local (gerado automaticamente na primeira execução).
* `package.json` - Manifesto das dependências de produção do Node.
* `public/` - Pasta com todos os arquivos estáticos de frontend puros (HTML, CSS e JS).
  * `index.html` - Página portal de boas-vindas do sistema.
  * `dashboard/` - Painel do administrador para monitoramento e controle.
  * `atendente/` - Painel de recepção do bar, cadastros e caixas de recargas.
  * `simulador/` - Simulador virtual de hardware de chopeiras e antenas NFC.
