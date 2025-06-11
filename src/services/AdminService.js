import axios from 'axios';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';

export const AdminService = {
  // Get dashboard statistics
  getDashboardStats: async () => {
    try {
      const response = await axios.get(`${API_URL}/admin/stats`, {
        headers: { 
          'Authorization': `Bearer ${localStorage.getItem('token')}` 
        }
      });
      return response.data;
    } catch (error) {
      console.error('Error fetching admin stats:', error);
      throw error;
    }
  },
  
  // Get users list
  getUsers: async () => {
    try {
      const response = await axios.get(`${API_URL}/admin/users`, {
        headers: { 
          'Authorization': `Bearer ${localStorage.getItem('token')}` 
        }
      });
      return response.data;
    } catch (error) {
      console.error('Error fetching users:', error);
      throw error;
    }
  },
  
  // Update system settings
  updateSettings: async (settings) => {
    try {
      const response = await axios.put(`${API_URL}/admin/settings`, settings, {
        headers: { 
          'Authorization': `Bearer ${localStorage.getItem('token')}` 
        }
      });
      return response.data;
    } catch (error) {
      console.error('Error updating settings:', error);
      throw error;
    }
  }
};

export default AdminService;
