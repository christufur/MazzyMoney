import React from 'react';
import SidebarLayout from '../components/layout/SidebarLayout';
import NetWorthChart from '../components/charts/NetWorthChart';

const NetWorthPage: React.FC = () => (
  <SidebarLayout title="Net worth">
    <NetWorthChart />
  </SidebarLayout>
);

export default NetWorthPage;
