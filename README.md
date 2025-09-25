# GB Auth SharePoint - Sistema de Sincronização de Colaboradores

## Visão Geral

Este sistema implementa um fluxo automatizado de sincronização **unidirecional** do Azure Active Directory para o SharePoint. O objetivo é manter os dados dos colaboradores atualizados no SharePoint com base nas informações mais recentes do Azure AD.

## Arquitetura e Dependências

O sistema utiliza as seguintes tecnologias principais:

-   `@microsoft/microsoft-graph-client` para interação com Microsoft Graph API
-   `@azure/msal-node` para autenticação com Azure AD
-   `dotenv` para gerenciamento de variáveis de ambiente
-   `isomorphic-fetch` para compatibilidade com fetch API

## Fluxo de Processamento

### 1. Inicialização e Autenticação

O sistema valida as variáveis de ambiente necessárias e realiza autenticação com Azure AD usando credenciais de aplicação (CLIENT_ID e CLIENT_SECRET) para obter token de acesso.

### 2. Coleta de Dados

- **Azure AD**: Busca todos os usuários com os campos específicos necessários
- **SharePoint**: Busca todos os colaboradores existentes na lista

### 3. Sincronização

Para cada usuário do Azure AD:
- Verifica se já existe no SharePoint (por AzureADId ou email)
- Se existe: compara campos e atualiza apenas os que mudaram
- Se não existe: cria novo registro no SharePoint

## Mapeamento de Campos

| Azure AD | SharePoint | Descrição |
|----------|------------|-----------|
| `displayName` | `Title` | Nome completo |
| `userPrincipalName` | `ExternalEmail` | Email/Account |
| `accountEnabled` | `Ativo` | Status do colaborador |
| `officeLocation` | `Unidade` | Unidade |
| `manager.displayName` | `Gerencia` | Líder Imediato |
| `department` | `Departamento` | Departamento |
| `jobTitle` | `Cargo` | Cargo |
| `extensionAttribute2` | `DataAniversario` | Data de aniversário |
| `extensionAttribute15` | `DataAdmissao` | Data de admissão |
| `id` | `AzureADId` | ID do Azure AD |

## Permissões Necessárias

### Microsoft Graph API (Application Permissions)

1. **`User.Read.All`** - Para ler informações de todos os usuários do Azure AD
2. **`Sites.ReadWrite.All`** - Para ler e escrever em sites e listas do SharePoint

### Configuração na App Registration

1. Acesse **Azure Portal** → **Azure Active Directory** → **App registrations**
2. Selecione sua aplicação
3. Vá em **"API permissions"**
4. Clique em **"Add a permission"**
5. Selecione **"Microsoft Graph"**
6. Escolha **"Application permissions"**
7. Adicione:
   - `User.Read.All`
   - `Sites.ReadWrite.All`
8. Clique em **"Grant admin consent"**

## Variáveis de Ambiente

```env
CLIENT_ID=seu_client_id
CLIENT_SECRET=seu_client_secret  
TENANT_ID=seu_tenant_id
SITE_ID=seu_site_id
LIST_ID=seu_list_id
```

## Execução

```bash
npm install
npm start
```

## Logs e Monitoramento

O sistema gera logs detalhados para:
- Inicialização e autenticação
- Processamento de cada usuário
- Operações de criação/atualização
- Resumo final da sincronização
