import axios, { AxiosInstance } from 'axios';

let apiInstance: AxiosInstance;

export function useApi(): AxiosInstance {
  if (!apiInstance) {
    apiInstance = axios.create({
      // '/api' relativo = stesso host (NAS LAN/VPN). Override solo in dev via VITE_API_URL.
      baseURL: import.meta.env.VITE_API_URL || '/api',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Error handler
    apiInstance.interceptors.response.use(
      (response) => response,
      (error) => {
        console.error('API error:', error);
        return Promise.reject(error);
      }
    );
  }

  return apiInstance;
}
