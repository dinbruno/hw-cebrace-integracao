// Funções para converter formatos de data do Azure AD

/**
 * Converte extensionAttribute2 do formato DDMMAAAA para Date
 * Exemplo: "21072000" -> Date(2000-07-21)
 * @param dateString String no formato DDMMAAAA
 * @returns Date ou null se inválido
 */
export function parseExtensionAttribute2(dateString: string | undefined): Date | null {
    if (!dateString || dateString.trim() === '') {
        return null;
    }

    // Limpar string
    const cleaned = dateString.trim();

    // Formato esperado: DDMMAAAA (8 dígitos)
    if (cleaned.length !== 8 || !/^\d{8}$/.test(cleaned)) {
        console.warn(`[Data] Formato inválido para extensionAttribute2: "${dateString}"`);
        return null;
    }

    try {
        const day = parseInt(cleaned.substring(0, 2), 10);
        const month = parseInt(cleaned.substring(2, 4), 10);
        const year = parseInt(cleaned.substring(4, 8), 10);

        // Validar valores
        if (day < 1 || day > 31 || month < 1 || month > 12 || year < 1900 || year > 2100) {
            console.warn(`[Data] Data inválida: ${day}/${month}/${year}`);
            return null;
        }

        // Criar data (mês é 0-indexed no JavaScript)
        const date = new Date(year, month - 1, day);

        // Verificar se a data é válida
        if (isNaN(date.getTime())) {
            console.warn(`[Data] Data inválida após conversão: ${day}/${month}/${year}`);
            return null;
        }

        return date;
    } catch (error) {
        console.error(`[Data] Erro ao converter extensionAttribute2: "${dateString}"`, error);
        return null;
    }
}

/**
 * Converte extensionAttribute15 do formato LDAP (AAAAMMDDHHMMSS.0Z) para Date
 * Exemplo: "20190219030000.0Z" -> Date(2019-02-19)
 * @param dateString String no formato LDAP
 * @returns Date ou null se inválido
 */
export function parseExtensionAttribute15(dateString: string | undefined): Date | null {
    if (!dateString || dateString.trim() === '') {
        return null;
    }

    // Limpar string
    const cleaned = dateString.trim();

    // Formato esperado: AAAAMMDDHHMMSS.0Z
    if (cleaned.length < 14) {
        console.warn(`[Data] Formato inválido para extensionAttribute15: "${dateString}"`);
        return null;
    }

    try {
        const year = parseInt(cleaned.substring(0, 4), 10);
        const month = parseInt(cleaned.substring(4, 6), 10);
        const day = parseInt(cleaned.substring(6, 8), 10);

        // Validar valores
        if (day < 1 || day > 31 || month < 1 || month > 12 || year < 1900 || year > 2100) {
            console.warn(`[Data] Data inválida: ${day}/${month}/${year}`);
            return null;
        }

        // Criar data (mês é 0-indexed no JavaScript)
        const date = new Date(year, month - 1, day);

        // Verificar se a data é válida
        if (isNaN(date.getTime())) {
            console.warn(`[Data] Data inválida após conversão: ${day}/${month}/${year}`);
            return null;
        }

        return date;
    } catch (error) {
        console.error(`[Data] Erro ao converter extensionAttribute15: "${dateString}"`, error);
        return null;
    }
}

/**
 * Converte employeeHireDate (formato ISO) para Date
 * Exemplo: "2019-02-19T03:00:00Z" -> Date(2019-02-19)
 * @param dateString String no formato ISO
 * @returns Date ou null se inválido
 */
export function parseEmployeeHireDate(dateString: string | undefined): Date | null {
    if (!dateString || dateString.trim() === '') {
        return null;
    }

    try {
        const date = new Date(dateString);

        // Verificar se a data é válida
        if (isNaN(date.getTime())) {
            console.warn(`[Data] Data inválida: "${dateString}"`);
            return null;
        }

        return date;
    } catch (error) {
        console.error(`[Data] Erro ao converter employeeHireDate: "${dateString}"`, error);
        return null;
    }
}

/**
 * Extrai data de aniversário dos atributos do Azure AD
 * Prioriza extensionAttribute2 do onPremises
 * @param onPremisesExtensionAttributes Atributos de extensão do AD local
 * @returns Date ou null
 */
export function extractBirthday(onPremisesExtensionAttributes: any): Date | null {
    if (!onPremisesExtensionAttributes) {
        return null;
    }

    // Tentar extrair do extensionAttribute2
    const attr2 = onPremisesExtensionAttributes.extensionAttribute2;
    if (attr2) {
        return parseExtensionAttribute2(attr2);
    }

    return null;
}

/**
 * Extrai data de admissão dos atributos do Azure AD
 * Prioriza employeeHireDate, depois extensionAttribute15
 * @param employeeHireDate Data de contratação (campo padrão)
 * @param onPremisesExtensionAttributes Atributos de extensão do AD local
 * @returns Date ou null
 */
export function extractHireDate(
    employeeHireDate: string | undefined,
    onPremisesExtensionAttributes: any
): Date | null {
    // Prioridade 1: employeeHireDate (campo padrão do Microsoft Graph)
    if (employeeHireDate) {
        const date = parseEmployeeHireDate(employeeHireDate);
        if (date) {
            return date;
        }
    }

    // Prioridade 2: extensionAttribute15 do onPremises
    if (onPremisesExtensionAttributes) {
        const attr15 = onPremisesExtensionAttributes.extensionAttribute15;
        if (attr15) {
            return parseExtensionAttribute15(attr15);
        }
    }

    return null;
}
