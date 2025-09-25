# 🚀 Guia de Deploy - Sincronização SharePoint

Este documento explica como configurar a execução automática diária da sincronização entre Azure AD e SharePoint.

## 📋 Opções de Deploy

### 1. 🆓 **GitHub Actions (Recomendado - Gratuito)**

**Vantagens:**
- ✅ Completamente gratuito
- ✅ Fácil configuração
- ✅ Logs detalhados
- ✅ Execução manual quando necessário

**Passos:**
1. Faça push do código para um repositório GitHub
2. Vá em `Settings > Secrets and variables > Actions`
3. Adicione os seguintes secrets:
   - `CLIENT_ID`
   - `CLIENT_SECRET`
   - `TENANT_ID`
   - `LIST_ID`
   - `SITE_ID`
4. O workflow executará automaticamente às **08:00 UTC** (05:00 Brasília) todos os dias

**Personalizar horário:** Edite o arquivo `.github/workflows/daily-sync.yml` e altere a linha:
```yaml
- cron: '0 8 * * *'  # Formato: minuto hora dia mês dia-da-semana
```

### 2. ☁️ **AWS Lambda + EventBridge**

**Vantagens:**
- ✅ Altamente escalável
- ✅ Paga apenas pelo uso
- ✅ Integração nativa com outros serviços AWS
- ✅ Monitoramento avançado

**Pré-requisitos:**
- AWS CLI configurado
- SAM CLI instalado

**Passos:**
```bash
# 1. Instalar SAM CLI
# https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html

# 2. Build e deploy
sam build -t deploy/lambda-template.yml
sam deploy --guided
```

### 3. 🔵 **Azure Functions (Nativo Microsoft)**

**Vantagens:**
- ✅ Integração nativa com Azure AD
- ✅ Mesmo ecossistema Microsoft
- ✅ Configuração simplificada de autenticação

**Pré-requisitos:**
- Azure CLI instalado

**Passos:**
```bash
# 1. Login no Azure
az login

# 2. Criar resource group
az group create --name sharepoint-sync-rg --location "Brazil South"

# 3. Deploy
az deployment group create \
  --resource-group sharepoint-sync-rg \
  --template-file deploy/azure-function.json \
  --parameters appName=sharepoint-sync-$(date +%s)
```

### 4. 🐳 **Docker + Cron (Servidor Próprio)**

**Vantagens:**
- ✅ Controle total
- ✅ Pode rodar em qualquer servidor
- ✅ Sem dependência de cloud

**Pré-requisitos:**
- Docker e Docker Compose instalados
- Arquivo `.env` com as variáveis

**Passos:**
```bash
# 1. Criar arquivo .env
CLIENT_ID=seu-client-id
CLIENT_SECRET=seu-client-secret
TENANT_ID=seu-tenant-id
LIST_ID=seu-list-id
SITE_ID=seu-site-id

# 2. Executar
docker-compose up -d

# 3. Ver logs
docker-compose logs -f
```

## ⏰ Configuração de Horários

### Formato Cron
```
* * * * *
│ │ │ │ │
│ │ │ │ └─ Dia da semana (0-7, 0 e 7 = domingo)
│ │ │ └─── Mês (1-12)
│ │ └───── Dia do mês (1-31)
│ └─────── Hora (0-23)
└───────── Minuto (0-59)
```

### Exemplos de Horários
```bash
# Todos os dias às 08:00
0 8 * * *

# Segunda a sexta às 09:30
30 9 * * 1-5

# Primeiro dia de cada mês às 06:00
0 6 1 * *

# A cada 6 horas
0 */6 * * *
```

## 🔧 Variáveis de Ambiente Necessárias

| Variável | Descrição | Exemplo |
|----------|-----------|---------|
| `CLIENT_ID` | ID da aplicação Azure AD | `12345678-1234-1234-1234-123456789012` |
| `CLIENT_SECRET` | Secret da aplicação Azure AD | `abcdef123456...` |
| `TENANT_ID` | ID do tenant Azure AD | `87654321-4321-4321-4321-210987654321` |
| `LIST_ID` | ID da lista SharePoint | `{12345678-1234-1234-1234-123456789012}` |
| `SITE_ID` | ID do site SharePoint | `contoso.sharepoint.com,12345678-1234-1234-1234-123456789012,87654321-4321-4321-4321-210987654321` |

## 📊 Monitoramento e Logs

### GitHub Actions
- Vá em `Actions` no seu repositório
- Clique no workflow para ver os logs detalhados

### AWS Lambda
- CloudWatch Logs: `/aws/lambda/[nome-da-funcao]`
- Métricas disponíveis no CloudWatch

### Azure Functions
- Application Insights para métricas detalhadas
- Logs disponíveis no portal Azure

### Docker
```bash
# Ver logs em tempo real
docker-compose logs -f

# Ver logs de um período específico
docker-compose logs --since="2024-01-01T00:00:00" --until="2024-01-01T23:59:59"
```

## 🛠️ Troubleshooting

### Problemas Comuns

1. **Erro de autenticação**
   - Verifique se todas as variáveis de ambiente estão corretas
   - Confirme se a aplicação Azure AD tem as permissões necessárias

2. **Lista/Site não encontrado**
   - Verifique os IDs do SharePoint
   - Confirme se a aplicação tem acesso ao site

3. **Timeout**
   - Para muitos usuários, aumente o timeout da função
   - Considere processar em lotes menores

### Logs Úteis
A aplicação gera logs detalhados que incluem:
- ✅ Usuários processados
- ✅ Colaboradores criados/atualizados
- ✅ Resumo da sincronização
- ❌ Erros específicos por usuário

## 💡 Recomendações

1. **Para começar:** Use GitHub Actions (gratuito e simples)
2. **Para produção:** AWS Lambda ou Azure Functions
3. **Para controle total:** Docker em servidor próprio
4. **Horário recomendado:** Entre 06:00-08:00 (antes do expediente)
5. **Monitoramento:** Configure alertas para falhas de execução

## 🔄 Próximos Passos

Após escolher uma opção, considere implementar:
- Alertas por email/Slack em caso de falha
- Dashboard para acompanhar sincronizações
- Backup automático antes das alterações
- Processamento incremental para melhor performance
