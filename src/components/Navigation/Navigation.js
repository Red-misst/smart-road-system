import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ListItem, ListItemIcon, ListItemText } from '@mui/material';
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings';

const Navigation = ({ user, closeDrawer }) => {
  const location = useLocation();

  // Update the admin navigation link
  const renderNavItems = () => {
    // Check if user is admin and add admin link
    if (user && user.role === 'admin') {
      return (
        <>
          {/* ...existing nav items... */}
          <ListItem 
            button 
            component={Link} 
            to="/admin" 
            selected={location.pathname === '/admin'}
            onClick={closeDrawer}
          >
            <ListItemIcon><AdminPanelSettingsIcon /></ListItemIcon>
            <ListItemText primary="Admin Dashboard" />
          </ListItem>
        </>
      );
    }
    
    // ...existing code...
  };

  return (
    <div>
      {/* ...existing code... */}
      {renderNavItems()}
      {/* ...existing code... */}
    </div>
  );
};

export default Navigation;