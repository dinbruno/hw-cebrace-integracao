// Dependências externas
import { Client } from '@microsoft/microsoft-graph-client';
import dotenv from 'dotenv';
import * as msal from '@azure/msal-node';
import 'isomorphic-fetch';

// Dependências internas
import { dateToUTC } from './utils/normalizeUtcDate';

dotenv.config();

// Interface para usuários do Azure AD
interface AzureADUser {
    id: string;
    displayName: string;
    userPrincipalName: string;
    accountEnabled: boolean;
    officeLocation?: string;
    department?: string;
    jobTitle?: string;
    manager?: {
        displayName: string;
    };
    extensionAttribute2?: string; // Data de aniversário
    extensionAttribute15?: string; // Data de admissão
}

// Interface para dados do SharePoint
interface SharePointEmployee {
    id?: string;
    Title: string; // Nome completo
    ExternalEmail: string; // Email
    Ativo: boolean; // Status
    Unidade?: string; // Office location
    Gerencia?: string; // Manager
    Departamento?: string; // Department
    Cargo?: string; // Job title
    DataAniversario?: string; // Extension attribute 2
    DataAdmissao?: string; // Extension attribute 15
    AzureADId: string; // ID do Azure AD
}

async function getAzureADUsers(client: Client): Promise<AzureADUser[]> {
    try {
        console.log('[Azure AD] Buscando todos os usuários...');
        
        const users: AzureADUser[] = [];
        let nextLink = null;
        
        do {
            const response = await client
                .api(nextLink || '/users')
                .select('id,displayName,userPrincipalName,accountEnabled,officeLocation,department,jobTitle,manager,extensionAttribute2,extensionAttribute15')
                .expand('manager($select=displayName)')
                .top(999)
                .get();
            
            users.push(...response.value);
            nextLink = response['@odata.nextLink'];
            
            console.log(`[Azure AD] Carregados ${users.length} usuários...`);
        } while (nextLink);
        
        console.log(`[Azure AD] Total de usuários carregados: ${users.length}`);
        return users;
    } catch (error: any) {
        console.error('[Azure AD] Erro ao buscar usuários:', error.message);
        throw error;
    }
}

export const lambdaHandler = async () => {
    const CLIENT_ID = process.env.CLIENT_ID || '';
    const CLIENT_SECRET = process.env.CLIENT_SECRET || '';
    const TENANT_ID = process.env.TENANT_ID || '';
    const SCOPES = ['https://graph.microsoft.com/.default'];
    const LIST_ID = process.env.LIST_ID || '';
    const SITE_ID = process.env.SITE_ID || '';

    try {
        // Validar variáveis de ambiente
        console.log('[Inicialização] Validando variáveis de ambiente...');
        if (!CLIENT_ID || !CLIENT_SECRET || !TENANT_ID || !LIST_ID || !SITE_ID) {
            console.error('[ERRO] Variáveis de ambiente faltando:');
            if (!CLIENT_ID) console.error('- CLIENT_ID');
            if (!CLIENT_SECRET) console.error('- CLIENT_SECRET');
            if (!TENANT_ID) console.error('- TENANT_ID');
            if (!LIST_ID) console.error('- LIST_ID');
            if (!SITE_ID) console.error('- SITE_ID');
            throw new Error('Variáveis de ambiente obrigatórias ausentes');
        }

        console.log('[Inicialização] Obtendo token de autenticação...');
        const cca = new msal.ConfidentialClientApplication({
            auth: {
                clientId: CLIENT_ID,
                authority: `https://login.microsoftonline.com/${TENANT_ID}`,
                clientSecret: CLIENT_SECRET,
            },
        });

        const resp = await cca.acquireTokenByClientCredential({
            scopes: SCOPES,
        });

        if (!resp || !resp.accessToken) {
            console.log('Falha ao obter o token de acesso');
            throw new Error('Falha ao obter o token de acesso');
        }

        const token = resp?.accessToken;
        console.log('[Inicialização] Token obtido com sucesso.');

        const client = Client.init({
            authProvider: (done) => {
                done(null, token);
            },
        });

        console.log(`[SharePoint] Verificando se o site ${SITE_ID} existe...`);
        try {
            const siteInfo = await client.api(`/sites/${SITE_ID}`).get();
            console.log(`[SharePoint] Site encontrado: ${siteInfo.displayName}`);
        } catch (error: any) {
            console.error(`[SharePoint] Erro ao acessar o site ${SITE_ID}:`, error.message);
            throw new Error(`Site não encontrado. Verifique o SITE_ID: ${SITE_ID}`);
        }

        console.log(`[SharePoint] Verificando se a lista ${LIST_ID} existe...`);
        try {
            const listInfo = await client.api(`/sites/${SITE_ID}/lists/${LIST_ID}`).get();
            console.log(`[SharePoint] Lista encontrada: ${listInfo.displayName}`);
        } catch (error: any) {
            console.error(`[SharePoint] Erro ao acessar a lista ${LIST_ID}:`, error.message);
            throw new Error(`Lista não encontrada. Verifique o LIST_ID: ${LIST_ID}`);
        }

        // 1. Buscar todos os usuários do Azure AD
        console.log('[Sincronização] Iniciando busca de usuários do Azure AD...');
        const azureUsers = await getAzureADUsers(client);
        
        // 2. Buscar colaboradores existentes no SharePoint
        console.log('[SharePoint] Buscando colaboradores existentes...');
        const response = await client.api(`/sites/${SITE_ID}/lists/${LIST_ID}/items`).top(10000).expand('fields').get();
        const employeesSP = response.value.map((employee: any) => ({ ...employee.fields, id: employee.id }));

        console.log(`[Dados] Azure AD: ${azureUsers.length} usuários | SharePoint: ${employeesSP.length} colaboradores`);

        let created = 0;
        let updated = 0;
        let skipped = 0;

        // 3. Processar cada usuário do Azure AD
        for (const azureUser of azureUsers) {
            try {
                console.log(`\n[Processando] ${azureUser.displayName} (${azureUser.userPrincipalName})`);
                
                // Converter dados do Azure AD para formato do SharePoint
                const sharePointData: Omit<SharePointEmployee, 'id'> = {
                    Title: azureUser.displayName,
                    ExternalEmail: azureUser.userPrincipalName,
                    Ativo: azureUser.accountEnabled,
                    Unidade: azureUser.officeLocation || '',
                    Gerencia: azureUser.manager?.displayName || '',
                    Departamento: azureUser.department || '',
                    Cargo: azureUser.jobTitle || '',
                    DataAniversario: azureUser.extensionAttribute2 ? dateToUTC(azureUser.extensionAttribute2) : null,
                    DataAdmissao: azureUser.extensionAttribute15 ? dateToUTC(azureUser.extensionAttribute15) : null,
                    AzureADId: azureUser.id,
                };

                // Verificar se usuário já existe no SharePoint (por AzureADId ou email)
                const existingEmployee = employeesSP.find(emp => 
                    emp.AzureADId === azureUser.id || 
                    emp.ExternalEmail === azureUser.userPrincipalName
                );

                if (existingEmployee) {
                    // Atualizar usuário existente
                    const updateData: any = {};
                    let hasChanges = false;

                    // Comparar e atualizar apenas campos que mudaram
                    if (existingEmployee.Title !== sharePointData.Title) {
                        updateData.Title = sharePointData.Title;
                        hasChanges = true;
                    }
                    if (existingEmployee.ExternalEmail !== sharePointData.ExternalEmail) {
                        updateData.ExternalEmail = sharePointData.ExternalEmail;
                        hasChanges = true;
                    }
                    if (existingEmployee.Ativo !== sharePointData.Ativo) {
                        updateData.Ativo = sharePointData.Ativo;
                        hasChanges = true;
                    }
                    if (existingEmployee.Unidade !== sharePointData.Unidade) {
                        updateData.Unidade = sharePointData.Unidade;
                        hasChanges = true;
                    }
                    if (existingEmployee.Gerencia !== sharePointData.Gerencia) {
                        updateData.Gerencia = sharePointData.Gerencia;
                        hasChanges = true;
                    }
                    if (existingEmployee.Departamento !== sharePointData.Departamento) {
                        updateData.Departamento = sharePointData.Departamento;
                        hasChanges = true;
                    }
                    if (existingEmployee.Cargo !== sharePointData.Cargo) {
                        updateData.Cargo = sharePointData.Cargo;
                        hasChanges = true;
                    }
                    if (existingEmployee.DataAniversario !== sharePointData.DataAniversario) {
                        updateData.DataAniversario = sharePointData.DataAniversario;
                        hasChanges = true;
                    }
                    if (existingEmployee.DataAdmissao !== sharePointData.DataAdmissao) {
                        updateData.DataAdmissao = sharePointData.DataAdmissao;
                        hasChanges = true;
                    }
                    if (existingEmployee.AzureADId !== sharePointData.AzureADId) {
                        updateData.AzureADId = sharePointData.AzureADId;
                        hasChanges = true;
                    }

                    if (hasChanges) {
                        console.log(`[SharePoint] Atualizando colaborador existente...`);
                        await client.api(`/sites/${SITE_ID}/lists/${LIST_ID}/items/${existingEmployee.id}`).update({
                            fields: updateData,
                        });
                        console.log(`[SharePoint] ✅ Colaborador atualizado: ${azureUser.displayName}`);
                        updated++;
                } else {
                        console.log(`[SharePoint] ℹ️ Nenhuma alteração necessária: ${azureUser.displayName}`);
                        skipped++;
                    }
                } else {
                    // Criar novo usuário
                    console.log(`[SharePoint] Criando novo colaborador...`);
                    const userData = {
                        fields: sharePointData,
                    };

                    await client.api(`/sites/${SITE_ID}/lists/${LIST_ID}/items`).post(userData);
                    console.log(`[SharePoint] ✅ Novo colaborador criado: ${azureUser.displayName}`);
                    created++;
                }
            } catch (error: any) {
                console.error(`[Erro] Falha ao processar usuário ${azureUser.displayName}:`, error.message);
            }
        }

        // 4. Exibir resumo da sincronização
        const finalCount = await client
            .api(`/sites/${SITE_ID}/lists/${LIST_ID}/items`)
            .top(10000)
            .expand('fields')
            .get();
            
        console.log(`
                    === RESUMO DA SINCRONIZAÇÃO ===
                    - Usuários processados do Azure AD: ${azureUsers.length}
                    - Colaboradores criados no SharePoint: ${created}
                    - Colaboradores atualizados no SharePoint: ${updated}
                    - Colaboradores sem alterações: ${skipped}
                    - Total final no SharePoint: ${finalCount.value.length}
                    `);
    } catch (err) {
        console.error('Erro durante a sincronização:', err);
        throw new Error('Error: \n' + err);
    }
};

lambdaHandler()
    .then(() => console.log('Sincronização concluída com sucesso!'))
    .catch((error) => console.error('Erro na sincronização:', error))
    .finally(() => process.exit(0));
