import { getCurrentInstance, onBeforeUpdate, shallowRef, toHandlerKey } from 'vue';

// Declared emits are removed from $attrs in Vue 3. Check the vnode instead.
export default function useHasEventListener(event: string) {
  const instance = getCurrentInstance();
  const present = () => Boolean(instance?.vnode.props?.[toHandlerKey(event)]);
  const hasListener = shallowRef(present());
  onBeforeUpdate(() => { hasListener.value = present(); });
  return hasListener;
}
