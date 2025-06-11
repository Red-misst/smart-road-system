import React, { useState, useEffect } from 'react';
import { Container, Typography, Box, Grid, Paper, Tabs, Tab } from '@mui/material';
import AdminService from '../../services/AdminService';
import './Admin.css';
import DashboardIcon from '@mui/icons-material/Dashboard';
import PeopleIcon from '@mui/icons-material/People';
import SettingsIcon from '@mui/icons-material/Settings';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';

function TabPanel(props) {
  const { children, value, index, ...other } = props;
  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`admin-tabpanel-${index}`}
      {...other}
    >
      {value === index && <Box p={3}>{children}</Box>}
    </div>
  );
}

export default function Admin() {
  const [value, setValue] = useState(0);
  const [stats, setStats] = useState({ users: 0, incidents: 0, resolvedIncidents: 0 });
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();
  const navigate = useNavigate();
  
  useEffect(() => {
    // Redirect if not admin
    if (!user || user.role !== 'admin') {
      navigate('/login');
      return;
    }
    
    const fetchAdminData = async () => {
      try {
        setLoading(true);
        const statsData = await AdminService.getDashboardStats();
        setStats(statsData);
        
        if (value === 1) {
          const usersData = await AdminService.getUsers();
          setUsers(usersData);
        }
      } catch (error) {
        console.error("Failed to fetch admin data:", error);
      } finally {
        setLoading(false);
      }
    };
    
    fetchAdminData();
  }, [value, user, navigate]);
  
  const handleTabChange = (event, newValue) => {
    setValue(newValue);
  };

  return (
    <Container className="admin-container">
      <Typography variant="h4" className="admin-title" gutterBottom>
        Admin Dashboard
      </Typography>
      
      <Paper className="admin-tabs-container">
        <Tabs
          value={value}
          onChange={handleTabChange}
          indicatorColor="primary"
          textColor="primary"
          centered
        >
          <Tab icon={<DashboardIcon />} label="Dashboard" />
          <Tab icon={<PeopleIcon />} label="Users" />
          <Tab icon={<SettingsIcon />} label="Settings" />
        </Tabs>
        
        <TabPanel value={value} index={0}>
          {/* Dashboard tab content */}
          <Grid container spacing={3}>
            <Grid item xs={12} md={4}>
              <Paper className="stat-card">
                <Typography variant="h6">Total Users</Typography>
                <Typography variant="h3">{stats.users}</Typography>
              </Paper>
            </Grid>
            <Grid item xs={12} md={4}>
              <Paper className="stat-card">
                <Typography variant="h6">Reported Incidents</Typography>
                <Typography variant="h3">{stats.incidents}</Typography>
              </Paper>
            </Grid>
            <Grid item xs={12} md={4}>
              <Paper className="stat-card">
                <Typography variant="h6">Resolved Incidents</Typography>
                <Typography variant="h3">{stats.resolvedIncidents}</Typography>
              </Paper>
            </Grid>
          </Grid>
        </TabPanel>
        
        <TabPanel value={value} index={1}>
          {/* Users tab content */}
          {/* ...existing code... */}
        </TabPanel>
        
        <TabPanel value={value} index={2}>
          {/* Settings tab content */}
          {/* ...existing code... */}
        </TabPanel>
      </Paper>
    </Container>
  );
}