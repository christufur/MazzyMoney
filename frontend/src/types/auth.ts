export interface User {
    id: string;
    email: string;
    fullName: string;
    createdAt: string;
    updatedAt: string;
    plaidItemId?: string | null;
  }
  
  export interface AuthResponse {
    token: string;
    user: User;
  }
  
  export interface LoginRequest {
    email: string;
    password: string;
  }
  
  export interface RegisterRequest {
    email: string;
    password: string;
    fullName: string;
  }