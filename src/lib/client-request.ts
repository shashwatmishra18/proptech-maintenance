import type { ApiResponse } from './errors/api-response';

export class RequestError extends Error {
    constructor(message: string, public uncertain = false, public status?: number) { super(message); }
}

export async function requestData<T>(url: string, options?: RequestInit): Promise<T> {
    let response: Response;
    try { response = await fetch(url, options); }
    catch { throw new RequestError('Network request failed. Check your connection and try again.', true); }
    let body: ApiResponse<T>;
    try { body = await response.json(); }
    catch { throw new RequestError('The server returned an unreadable response. Please try again.', true); }
    if (!response.ok || !body.success) {
        throw new RequestError(!body.success ? body.error : 'The request failed. Please try again.', false, response.status);
    }
    return body.data;
}
