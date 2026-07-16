import { createNavigationContainerRef } from '@react-navigation/native';

// A global ref so the push-notification tap handler (outside React's render
// tree) can navigate without needing a screen-level useNavigation() hook.
export const navigationRef = createNavigationContainerRef();

export const navigateToOrder = (orderId: string): void => {
  if (!navigationRef.isReady()) return;

  // 'OrderStatus' is defined once in StaffStack and once in AdminStack —
  // only one of those two is ever mounted for a signed-in user, so
  // navigating by name resolves into whichever is active. The untyped root
  // ref doesn't model nested navigators of different shapes, hence `as any`.
  (navigationRef.navigate as any)('OrderStatus', { orderId });
};
