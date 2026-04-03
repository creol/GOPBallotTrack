import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
});

// Redirect to login on 401 (except for /auth endpoints)
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401 && !error.config.url.includes('/auth/')) {
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export default api;
