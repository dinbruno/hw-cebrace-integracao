#!/bin/bash

# Script de deploy para diferentes plataformas
# Usage: ./deploy.sh [github|aws|azure|docker]

PLATFORM=${1:-github}

case $PLATFORM in
  "github")
    echo "🚀 Configurando GitHub Actions..."
    echo "1. Faça push do código para GitHub"
    echo "2. Vá em Settings > Secrets and variables > Actions"
    echo "3. Adicione os secrets:"
    echo "   - CLIENT_ID"
    echo "   - CLIENT_SECRET"
    echo "   - TENANT_ID"
    echo "   - LIST_ID"
    echo "   - SITE_ID"
    echo "4. O workflow será executado automaticamente às 08:00 UTC"
    ;;
    
  "aws")
    echo "🚀 Fazendo deploy no AWS Lambda..."
    if ! command -v sam &> /dev/null; then
      echo "❌ SAM CLI não encontrado. Instale: https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html"
      exit 1
    fi
    
    echo "📦 Fazendo build..."
    sam build -t deploy/lambda-template.yml
    
    echo "🚀 Fazendo deploy..."
    sam deploy --guided
    ;;
    
  "azure")
    echo "🚀 Fazendo deploy no Azure Functions..."
    if ! command -v az &> /dev/null; then
      echo "❌ Azure CLI não encontrado. Instale: https://docs.microsoft.com/en-us/cli/azure/install-azure-cli"
      exit 1
    fi
    
    echo "📦 Criando resource group..."
    az group create --name sharepoint-sync-rg --location "Brazil South"
    
    echo "🚀 Fazendo deploy..."
    az deployment group create \
      --resource-group sharepoint-sync-rg \
      --template-file deploy/azure-function.json \
      --parameters appName=sharepoint-sync-$(date +%s)
    ;;
    
  "docker")
    echo "🚀 Executando com Docker..."
    if [ ! -f .env ]; then
      echo "❌ Arquivo .env não encontrado. Crie um com as variáveis necessárias."
      exit 1
    fi
    
    echo "📦 Fazendo build da imagem..."
    docker-compose build
    
    echo "🚀 Iniciando containers..."
    docker-compose up -d
    
    echo "✅ Aplicação rodando. Logs:"
    docker-compose logs -f
    ;;
    
  *)
    echo "❌ Plataforma não suportada: $PLATFORM"
    echo "Opções: github, aws, azure, docker"
    exit 1
    ;;
esac
