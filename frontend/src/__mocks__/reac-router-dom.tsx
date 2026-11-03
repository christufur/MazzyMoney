import React from 'react';

export const MemoryRouter = ({ children }: { children: React.ReactNode }) => <>{children}</>;
export const NavLink = ({ children }: { children: React.ReactNode }) => <>{children}</>;
export const useNavigate = () => jest.fn();
export const useLocation = () => ({ pathname: '/' });
export const useParams = () => ({});