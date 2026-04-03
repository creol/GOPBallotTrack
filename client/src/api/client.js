import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
});

// Redirect to login on 401 (only for /admin endpoints)
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401 && error.config.url.includes('/admin')) {
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export default api;
