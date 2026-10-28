# PKL GuildBoard

Ferramenta Google Apps Script para acompanhar o desenvolvimento de uma Guild no Poke Legends.

---

## Instalação passo a passo

### 1. Copie a planilha template

Abra a [planilha template](https://docs.google.com/spreadsheets/d/1jh-Np4IvCMkOm9nep-xLRzfQ33luIFAQv_FUN4xBmBE/edit?usp=sharing) e faça uma cópia para o seu Google Drive:
**Arquivo → Fazer uma cópia**.

Anote o **ID da planilha** — é a sequência de letras e números que aparece na URL entre `/d/` e `/edit`:

```
https://docs.google.com/spreadsheets/d/ESTE_E_O_ID/edit
```

---

### 2. Crie o projeto no Google Apps Script

1. Acesse [script.google.com](https://script.google.com) e clique em **Novo projeto**.
2. Dê um nome ao projeto (ex.: `PKL GuildBoard – Minha Guild`).
3. Copie cada arquivo do repositório (`.js` e `.html`) para o projeto, respeitando os nomes exatos.
   - Arquivos `.js` → tipo **Script**
   - Arquivos `.html` → tipo **HTML**
   - O arquivo `appsscript.json` substitui o manifesto padrão (ative a exibição do manifesto em **Configurações do projeto → Mostrar arquivo "appsscript.json"**).

---

### 3. Configure as Script Properties

No editor do Apps Script vá em **Projeto → Propriedades do projeto → Propriedades de script** e adicione as chaves abaixo.

| Chave                    | Obrigatória            | Descrição                                                                                                                                        |
| ------------------------ | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `SPREADSHEET_ID`         | Sim                    | ID da planilha copiada no passo 1                                                                                                                |
| `SESSION_SECRET`         | Gerada automaticamente | Deixe em branco; o sistema gera na primeira execução de `setupAdminPassword`                                                                     |
| `SESSION_DURATION_HOURS` | Gerada automaticamente | Deixe em branco; o sistema define como `6` na primeira execução de `setupAdminPassword`                                                          |
| `GUILD_NAME`             | Não                    | Nome da sua Guild exibido na interface (ex.: `Arkham`)                                                                                           |
| `GUILD_LOGO_URL`         | Não                    | URL da imagem da Guild — pode ser a URL da página do Imgur (ex.: `https://imgur.com/AbCd123`) ou qualquer URL pública. Recomendado: 400 × 150 px |
| `GUILD_API_URL`          | Não                    | URL da API do jogo, se a sua Guild tiver acesso                                                                                                  |

> **Dica — imagem da Guild no Imgur:** hospede no [Imgur](https://imgur.com) e cole a URL da página da imagem diretamente (ex.: `https://imgur.com/dOgObo9`). O sistema converte automaticamente para o link de imagem — **não é necessário buscar o link direto**. URLs de álbum (`https://imgur.com/a/ID`) não são suportadas. Quando não configurada, o nome da Guild aparece no lugar sem espaço em branco.

---

### 4. Defina a senha de admin

O editor do Apps Script não aceita chamar funções com parâmetros diretamente. Use o seguinte procedimento:

1. Abra qualquer arquivo `.gs` no editor (ex.: `Auth.js`).
2. **Adicione temporariamente** no final do arquivo:
   ```js
   function inicializar() {
     setupAdminPassword("suasenhaaqui"); // troque pela sua senha
   }
   ```
3. No seletor de funções no topo do editor, escolha **`inicializar`**.
4. Clique no botão **▶ Executar**.
5. Autorize as permissões se solicitado.
6. Após a execução bem-sucedida, **remova** a função `inicializar` do arquivo.

> - A senha deve ter **pelo menos 8 caracteres**.
> - Essa função também gera o `SESSION_SECRET` e define `SESSION_DURATION_HOURS` automaticamente — você não precisa preencher essas propriedades manualmente.
> - Para **trocar a senha** no futuro, repita o mesmo procedimento com a nova senha.

---

### 5. Configure o Trigger de sincronização

O GuildBoard sincroniza dados do jogo automaticamente via um trigger programado.

1. No editor do Apps Script, acesse **Projeto → Acionadores** (ou clique no ícone de relógio ⏰ na barra lateral).
2. Clique em **+ Adicionar acionador**.
3. Configure:
   - **Função a executar:** `runTimeDrivenGuildSync`
   - **Origem do evento:** Acionado por tempo
   - **Tipo:** Acionador de minutos
   - **Intervalo:** A cada **15 minutos**
4. Clique em **Salvar** e autorize as permissões se solicitado.

> O trigger só sincroniza se a Script Property `GUILD_API_URL` estiver configurada. Sem ela, a sincronização é ignorada silenciosamente.

---

### 6. Faça o deploy como Web App

1. Clique em **Implantar → Nova implantação**.
2. Tipo: **Aplicativo da Web**.
3. Configurações recomendadas:
   - **Executar como:** Eu (conta do proprietário)
   - **Quem tem acesso:** Qualquer pessoa
4. Clique em **Implantar** e copie a **URL do Web App**.

Compartilhe essa URL com os membros da sua Guild.

---

## Atualização

Para atualizar para uma nova versão:

1. Substitua os arquivos modificados no projeto do Apps Script.
2. Crie uma nova implantação (**Implantar → Gerenciar implantações → Nova versão**).
3. A URL permanece a mesma se você usar a implantação original.

---

## Instalação via clasp (alternativa para quem tem familiaridade com terminal)

O [clasp](https://github.com/google/clasp) permite enviar os arquivos do projeto diretamente do computador para o Apps Script, sem copiar manualmente.

### Pré-requisitos

- [Node.js](https://nodejs.org) instalado
- Conta Google com acesso ao Apps Script

### Passo a passo

1. **Instale o clasp globalmente:**

   ```bash
   npm install -g @google/clasp
   ```

2. **Faça login com sua conta Google:**

   ```bash
   clasp login
   ```

3. **Crie o projeto no Apps Script** (ou use um existente):

   ```bash
   clasp create --title "PKL GuildBoard – Minha Guild" --type webapp
   ```

   Isso cria um arquivo `.clasp.json` na pasta com o `scriptId` do projeto.

4. **Configure o `.clasp.json`** para apontar para a pasta raiz do projeto:

   ```json
   {
     "scriptId": "SEU_SCRIPT_ID",
     "rootDir": "."
   }
   ```

5. **Envie os arquivos para o Apps Script:**
   ```bash
   clasp push
   ```
   > Se o editor do Apps Script estiver aberto, feche e reabra para ver os arquivos atualizados.

> Para atualizações futuras, basta editar os arquivos localmente e rodar `clasp push` novamente.

---

_PKL GuildBoard é uma ferramenta criada pela Guild Arkham para a comunidade de Poke Legends._
