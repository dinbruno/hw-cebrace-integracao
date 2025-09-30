import { Client } from '@microsoft/microsoft-graph-client';
import dotenv from 'dotenv';
import * as msal from '@azure/msal-node';
import 'isomorphic-fetch';

import { dateToUTC } from './utils/normalizeUtcDate';
import { extractBirthday, extractHireDate } from './utils/parseDates';

dotenv.config();

interface OnPremisesExtensionAttributes {
    extensionAttribute1?: string;
    extensionAttribute2?: string;
    extensionAttribute3?: string;
    extensionAttribute4?: string;
    extensionAttribute5?: string;
    extensionAttribute6?: string;
    extensionAttribute7?: string;
    extensionAttribute8?: string;
    extensionAttribute9?: string;
    extensionAttribute10?: string;
    extensionAttribute11?: string;
    extensionAttribute12?: string;
    extensionAttribute13?: string;
    extensionAttribute14?: string;
    extensionAttribute15?: string;
}

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
        userPrincipalName?: string;
        mail?: string;
    };
    employeeHireDate?: string;
    onPremisesExtensionAttributes?: OnPremisesExtensionAttributes;
}

interface SharePointEmployee {
    id?: string;
    Title: string;
    ExternalEmail: string;
    AccountLookupId?: number;
    Ativo: boolean;
    UnidadeLookupId?: number;
    LiderImediatoId?: string;
    DepartamentoLookupId?: number;
    JobTitle?: string;
    BirthdayDate?: string;
    DataContratacao?: string;
    AzureADId: string;
}

interface LookupItem {
    id: number;
    Title: string;
}

interface LookupCache {
    unidades: Map<string, number>;
    departamentos: Map<string, number>;
}

async function getLookupItems(client: Client, siteId: string, listId: string): Promise<LookupItem[]> {
    try {
        console.log(`[Lookup] Buscando itens da lista ${listId}...`);
        
        const items: LookupItem[] = [];
        let nextLink = null;
        
        do {
            const response = await client
                .api(nextLink || `/sites/${siteId}/lists/${listId}/items`)
                .expand('fields($select=Title)')
                .top(5000)
                .get();
            
            const mappedItems = response.value.map((item: any) => ({
                id: parseInt(item.id),
                Title: item.fields.Title || ''
            }));
            
            items.push(...mappedItems);
            nextLink = response['@odata.nextLink'];
            
        } while (nextLink);
        
        console.log(`[Lookup] ${items.length} itens encontrados na lista ${listId}`);
        return items;
    } catch (error: any) {
        console.error(`[Lookup] Erro ao buscar lista ${listId}:`, error.message);
        throw error;
    }
}

async function createLookupItem(client: Client, siteId: string, listId: string, title: string): Promise<number> {
    try {
        console.log(`[Lookup] Criando novo item "${title}" na lista ${listId}...`);
        
        const response = await client
            .api(`/sites/${siteId}/lists/${listId}/items`)
            .post({
                fields: {
                    Title: title
                }
            });
        
        const newId = parseInt(response.id);
        console.log(`[Lookup] ✅ Item "${title}" criado com ID ${newId}`);
        return newId;
    } catch (error: any) {
        console.error(`[Lookup] Erro ao criar item "${title}" na lista ${listId}:`, error.message);
        throw error;
    }
}

async function getOrCreateLookupId(
    client: Client, 
    siteId: string, 
    listId: string, 
    title: string, 
    cache: Map<string, number>
): Promise<number | null> {
    if (!title || title.trim() === '') {
        return null;
    }
    
    const normalizedTitle = title.trim();
    
    if (cache.has(normalizedTitle)) {
        return cache.get(normalizedTitle)!;
    }
    
    try {
        const newId = await createLookupItem(client, siteId, listId, normalizedTitle);
        cache.set(normalizedTitle, newId);
        return newId;
    } catch (error) {
        console.error(`[Lookup] Falha ao criar/obter lookup para "${normalizedTitle}":`, error);
        return null;
    }
}

function normalizeString(str: string): string {
    return str
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim()
        .replace(/\s+/g, ' ');
}

const sharePointUserIdCache = new Map<string, number>();

async function ensureSharePointUser(client: Client, siteId: string, email: string, accessToken: string): Promise<number | null> {
    const cacheKey = `user_${email}`;
    if (sharePointUserIdCache.has(cacheKey)) {
        return sharePointUserIdCache.get(cacheKey)!;
    }

    try {
        const siteInfo = await client.api(`/sites/${siteId}`).get();
        const siteUrl = siteInfo.webUrl;
        const ensureUserUrl = `${siteUrl}/_api/web/ensureuser`;
        
        const response = await fetch(ensureUserUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Accept': 'application/json;odata=verbose',
                'Content-Type': 'application/json;odata=verbose'
            },
            body: JSON.stringify({
                'logonName': `i:0#.f|membership|${email}`
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.log(`[SharePoint User] ⚠️  Não foi possível garantir usuário ${email}: ${response.status}`);
            return null;
        }

        const data = await response.json();
        const userId = data.d.Id;
        
        sharePointUserIdCache.set(cacheKey, userId);
        console.log(`[SharePoint User] ✅ Usuário garantido: ${email} -> ID ${userId}`);
        return userId;
        
    } catch (error: any) {
        console.error(`[SharePoint User] Erro ao garantir usuário ${email}:`, error.message);
        return null;
    }
}

async function getSharePointUserClaims(client: Client, siteId: string, email: string): Promise<string | null> {
    try {
        console.log(`[SharePoint User] 📧 Usando Claims format para: ${email}`);
        return `i:0#.f|membership|${email}`;
        
    } catch (error: any) {
        console.error(`[SharePoint User] Erro ao processar usuário ${email}:`, error.message);
        return null;
    }
}

async function findLiderImediatoClaims(
    client: Client,
    siteId: string,
    managerName: string,
    managerEmail: string | null
): Promise<string | null> {
    if (!managerName || managerName.trim() === '') {
        return null;
    }
    
    try {
        if (managerEmail) {
            const claims = await getSharePointUserClaims(client, siteId, managerEmail);
            if (claims) {
                console.log(`[Líder Imediato] ✅ Claims gerado: "${managerName}" (${managerEmail})`);
                return claims;
            }
        }
        
        console.log(`[Líder Imediato] ⚠️ Líder "${managerName}" sem email, não é possível gerar Claims`);
        return null;
        
    } catch (error: any) {
        console.error(`[Líder Imediato] Erro ao processar gerente:`, error.message);
        return null;
    }
}

async function initializeLookupCache(client: Client, siteId: string, listId: string): Promise<LookupCache> {
    console.log('[Lookup] Inicializando cache de lookups...');
    
    const UNIDADE_LIST_ID = '27bca630-da01-4605-a4fd-8b29808077dc';
    const DEPARTAMENTOS_LIST_ID = '832831dd-45fb-434a-8479-630414023491';
    
    const unidadesItems = await getLookupItems(client, siteId, UNIDADE_LIST_ID);
    const unidadesMap = new Map<string, number>();
    unidadesItems.forEach(item => {
        if (item.Title) {
            unidadesMap.set(item.Title.trim(), item.id);
        }
    });
    
    const departamentosItems = await getLookupItems(client, siteId, DEPARTAMENTOS_LIST_ID);
    const departamentosMap = new Map<string, number>();
    departamentosItems.forEach(item => {
        if (item.Title) {
            departamentosMap.set(item.Title.trim(), item.id);
        }
    });
    
    console.log(`[Lookup] Cache inicializado: ${unidadesMap.size} unidades, ${departamentosMap.size} departamentos`);
    
    return {
        unidades: unidadesMap,
        departamentos: departamentosMap
    };
}

async function getAzureADUsers(client: Client): Promise<AzureADUser[]> {
    try {
        console.log('[Azure AD] Buscando todos os usuários...');
        
        const users: AzureADUser[] = [];
        let nextLink = null;
        
        do {
            const response = await client
                .api(nextLink || '/users')
                .version('beta')
                .select('id,displayName,userPrincipalName,accountEnabled,officeLocation,department,jobTitle,manager,employeeHireDate,onPremisesExtensionAttributes')
                .expand('manager($select=displayName,userPrincipalName,mail)')
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
    const LIMIT_USERS = process.env.LIMIT_USERS ? parseInt(process.env.LIMIT_USERS) : undefined;

    let accessToken = '';

    try {
        console.log('[Inicialização] Validando variáveis de ambiente...');
        
        if (LIMIT_USERS) {
            console.log(`[Configuração] ⚠️  MODO DE TESTE: Limitado a ${LIMIT_USERS} usuários`);
        }
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

        accessToken = resp?.accessToken;
        console.log('[Inicialização] Token obtido com sucesso.');

        const client = Client.init({
            authProvider: (done) => {
                done(null, accessToken);
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

        console.log('[Sincronização] Inicializando cache de lookups...');
        const lookupCache = await initializeLookupCache(client, SITE_ID, LIST_ID);
        
        console.log('[Sincronização] Iniciando busca de usuários do Azure AD...');
        let azureUsers = await getAzureADUsers(client);
        
        if (LIMIT_USERS && LIMIT_USERS > 0) {
            console.log(`[Configuração] Aplicando limite de ${LIMIT_USERS} usuários...`);
            azureUsers = azureUsers.slice(0, LIMIT_USERS);
            console.log(`[Configuração] ✅ ${azureUsers.length} usuários serão processados`);
        }
        
        console.log('[SharePoint] Buscando colaboradores existentes...');
        const response = await client.api(`/sites/${SITE_ID}/lists/${LIST_ID}/items`).top(10000).expand('fields').get();
        const employeesSP = response.value.map((employee: any) => ({ ...employee.fields, id: employee.id }));

        console.log(`[Dados] Azure AD: ${azureUsers.length} usuários | SharePoint: ${employeesSP.length} colaboradores`);

        let created = 0;
        let updated = 0;
        let skipped = 0;
        let managersUpdated = 0;

        console.log('\n=== FASE 1: SINCRONIZAÇÃO DE COLABORADORES (SEM GERENTES) ===\n');

        for (const azureUser of azureUsers) {
            try {
                console.log(`\n${'='.repeat(80)}`);
                console.log(`[Processando] ${azureUser.displayName}`);
                console.log(`${'='.repeat(80)}`);
                console.log('📋 DADOS DO AZURE AD:');
                console.log('   ID:', azureUser.id);
                console.log('   Nome:', azureUser.displayName);
                console.log('   Email:', azureUser.userPrincipalName);
                console.log('   Ativo:', azureUser.accountEnabled);
                console.log('   Unidade (officeLocation):', azureUser.officeLocation || '(vazio)');
                console.log('   Departamento:', azureUser.department || '(vazio)');
                console.log('   Cargo (jobTitle):', azureUser.jobTitle || '(vazio)');
                console.log('   Gerente:', azureUser.manager?.displayName || '(sem gerente)');
                if (azureUser.manager) {
                    console.log('   Email do Gerente:', azureUser.manager.userPrincipalName || azureUser.manager.mail || '(sem email)');
                }
                console.log('   employeeHireDate:', azureUser.employeeHireDate || '(vazio)');
                if (azureUser.onPremisesExtensionAttributes) {
                    console.log('   extensionAttribute2 (Aniversário):', azureUser.onPremisesExtensionAttributes.extensionAttribute2 || '(vazio)');
                    console.log('   extensionAttribute15 (Data Admissão):', azureUser.onPremisesExtensionAttributes.extensionAttribute15 || '(vazio)');
                }
                console.log('');
                
                const accountUserId = await ensureSharePointUser(client, SITE_ID, azureUser.userPrincipalName, accessToken);
                
                const unidadeId = await getOrCreateLookupId(
                    client, 
                    SITE_ID, 
                    '27bca630-da01-4605-a4fd-8b29808077dc',
                    azureUser.officeLocation || '', 
                    lookupCache.unidades
                );
                
                const departamentoId = await getOrCreateLookupId(
                    client, 
                    SITE_ID, 
                    '832831dd-45fb-434a-8479-630414023491',
                    azureUser.department || '', 
                    lookupCache.departamentos
                );
                
                const birthdayDate = extractBirthday(azureUser.onPremisesExtensionAttributes);
                const hireDateObj = extractHireDate(azureUser.employeeHireDate, azureUser.onPremisesExtensionAttributes);
                
                const dataAniversario = birthdayDate ? (dateToUTC(birthdayDate) || undefined) : undefined;
                const dataAdmissao = hireDateObj ? (dateToUTC(hireDateObj) || undefined) : undefined;
                
                if (dataAniversario) {
                    console.log(`   📅 Data de aniversário: ${dataAniversario}`);
                }
                if (dataAdmissao) {
                    console.log(`   📅 Data de admissão: ${dataAdmissao}`);
                }
                
                const sharePointData: any = {
                    Title: azureUser.displayName,
                    ExternalEmail: azureUser.userPrincipalName,
                    Ativo: azureUser.accountEnabled,
                    JobTitle: azureUser.jobTitle || '',
                    BirthdayDate: dataAniversario,
                    DataContratacao: dataAdmissao,
                    AzureADId: azureUser.id,
                    AccountId: accountUserId,
                };
                
                if (accountUserId) {
                    sharePointData.AccountId = accountUserId;
                }
                
                if (unidadeId) {
                    sharePointData.UnidadeLookupId = unidadeId;
                }
                if (departamentoId) {
                    sharePointData.DepartamentoLookupId = departamentoId;
                }

                const existingEmployee = employeesSP.find((emp: any) => 
                    emp.AzureADId === azureUser.id || 
                    emp.ExternalEmail === azureUser.userPrincipalName
                );

                if (existingEmployee) {
                    const updateData: any = {};
                    let hasChanges = false;

                    if (existingEmployee.Title !== sharePointData.Title) {
                        updateData.Title = sharePointData.Title;
                        hasChanges = true;
                    }
                    if (existingEmployee.ExternalEmail !== sharePointData.ExternalEmail) {
                        updateData.ExternalEmail = sharePointData.ExternalEmail;
                        hasChanges = true;
                    }
                    if (existingEmployee.AccountId !== sharePointData.AccountId) {
                        updateData.AccountId = sharePointData.AccountId;
                        hasChanges = true;
                    }
                    if (existingEmployee.Ativo !== sharePointData.Ativo) {
                        updateData.Ativo = sharePointData.Ativo;
                        hasChanges = true;
                    }
                    if (existingEmployee.UnidadeLookupId !== sharePointData.UnidadeLookupId) {
                        updateData.UnidadeLookupId = sharePointData.UnidadeLookupId;
                        hasChanges = true;
                    }
                    if (existingEmployee.DepartamentoLookupId !== sharePointData.DepartamentoLookupId) {
                        updateData.DepartamentoLookupId = sharePointData.DepartamentoLookupId;
                        hasChanges = true;
                    }
                    if (existingEmployee.JobTitle !== sharePointData.JobTitle) {
                        updateData.JobTitle = sharePointData.JobTitle;
                        hasChanges = true;
                    }
                    if (existingEmployee.BirthdayDate !== sharePointData.BirthdayDate) {
                        updateData.BirthdayDate = sharePointData.BirthdayDate;
                        hasChanges = true;
                    }
                    if (existingEmployee.DataContratacao !== sharePointData.DataContratacao) {
                        updateData.DataContratacao = sharePointData.DataContratacao;
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
                    console.log(`[SharePoint] Criando novo colaborador...`);
                    const userData = {
                        fields: sharePointData,
                    };

                    const createdItem = await client.api(`/sites/${SITE_ID}/lists/${LIST_ID}/items`).post(userData);
                    console.log(`[SharePoint] ✅ Novo colaborador criado: ${azureUser.displayName}`);
                    created++;
                }
            } catch (error: any) {
                console.error(`[Erro] Falha ao processar usuário ${azureUser.displayName}:`, error.message);
            }
        }

        console.log('\n=== FASE 2: ATUALIZAÇÃO DE RELACIONAMENTOS DE GERENTES ===\n');
        
        console.log('[SharePoint] Recarregando lista de colaboradores...');
        const response2 = await client.api(`/sites/${SITE_ID}/lists/${LIST_ID}/items`).top(10000).expand('fields').get();
        const employeesSP2 = response2.value.map((employee: any) => ({ ...employee.fields, id: employee.id }));
        
        console.log(`[SharePoint] ${employeesSP2.length} colaboradores carregados para atualização de gerentes`);
        
        for (const azureUser of azureUsers) {
            try {
                if (!azureUser.manager?.displayName) {
                    continue;
                }
                
                console.log(`\n[Atualizando Gerente] ${azureUser.displayName} -> Gerente: ${azureUser.manager.displayName}`);
                
                const managerEmail = azureUser.manager.userPrincipalName || azureUser.manager.mail || null;
                const liderImediatoClaims = await findLiderImediatoClaims(
                    client,
                    SITE_ID,
                    azureUser.manager.displayName,
                    managerEmail
                );
                
                if (!liderImediatoClaims) {
                    console.log(`   ⚠️  Gerente sem Claims, pulando atualização`);
                    continue;
                }
                
                const existingEmployee = employeesSP2.find((emp: any) => 
                    emp.AzureADId === azureUser.id || 
                    emp.ExternalEmail === azureUser.userPrincipalName
                );
                
                if (!existingEmployee) {
                    console.log(`   ⚠️  Colaborador não encontrado no SharePoint`);
                    continue;
                }
                
                if (existingEmployee.LiderImediato === liderImediatoClaims) {
                    console.log(`   ℹ️  Gerente já está correto`);
                    continue;
                }
                
                await client.api(`/sites/${SITE_ID}/lists/${LIST_ID}/items/${existingEmployee.id}`).update({
                    fields: {
                        LiderImediato: liderImediatoClaims
                    }
                });
                
                console.log(`   ✅ Gerente atualizado com sucesso`);
                managersUpdated++;
                
            } catch (error: any) {
                console.error(`[Erro] Falha ao atualizar gerente de ${azureUser.displayName}:`, error.message);
            }
        }

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
                    - Relacionamentos de gerente atualizados: ${managersUpdated}
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
