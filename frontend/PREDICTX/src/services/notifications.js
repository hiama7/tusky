// The logged-in user's notifications and activity timeline.
import { get, post } from './api';

export const getNotifications = () => get('/notifications');
export const markAllRead = () => post('/notifications/read-all');
export const markRead = (id) => post(`/notifications/${id}/read`);
export const getActivity = () => get('/users/me/activity').then((d) => d.items);
