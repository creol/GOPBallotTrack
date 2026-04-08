import { createContext, useContext } from 'react';

const AuthContext = createContext({ auth: { role: null, name: null }, onLogout: () => {} });

export function AuthProvider({ auth, onLogout, children }) {
  return (
    <AuthContext.Provider value={{ auth, onLogout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
