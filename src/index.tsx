import { applySnapshot, IAnyModelType, Instance, onSnapshot, SnapshotIn } from 'mobx-state-tree';
import React, { createContext, useContext } from 'react';
import { PartialDeep } from 'type-fest';
import useAsyncEffect from 'use-async-effect';
import { debounce } from './utils/debounce';
import merge from './utils/merge';
import { getItem, removeItem, setItem } from './utils/storage';

export interface PersistentStoreOptions {
  /**
   * the key to use as the localforage key. default is 'persistentStore'.
   * must be changed when using multiple stores in the same app to avoid
   * overriding data.
   */
  storageKey: string;
  /**
   * On Repeated Store Update, it's advisable to wait a certain time before
   * updating the persistent storage with new snapshot. This value controls
   * the debounce delay. default is 1500 (ms)
   */
  writeDelay: number;
  /**
   * Whether to enable logging. By default, logging is enabled in
   * development mode only.
   */
  logging: boolean;
  /**
   * Whether to integrate with mobx-devtool. By default, it is
   * enabled on development mode only.
   */
  devtool: boolean;
}

const isDev =
  typeof process === 'object' && process.env && process.env.NODE_ENV === 'development'
    ? true
    : false;

const defaultOptions: PersistentStoreOptions = {
  storageKey: 'persistentStore',
  writeDelay: 1500,
  logging: isDev,
  devtool: isDev,
};

const createPersistentStore = <T extends IAnyModelType>(
  /**
   * The MST Root Store Model
   */
  store: T,
  /** Initial Store Value */
  init: SnapshotIn<T>,
  /** Part of the store that will not be persisted. */
  blacklist?: PartialDeep<SnapshotIn<T>>,
  /** Various options to change store behavior. */
  options?: Partial<PersistentStoreOptions>
) => {
  const { storageKey, writeDelay, devtool, logging } = options
    ? merge(defaultOptions, options)
    : defaultOptions;
  const initStore = blacklist ? merge(init, blacklist) : init;

  // Store Contest and Value
  const PersistentStoreContext = createContext<Instance<T> | null>(null);
  const mstStore: Instance<T> = store.create(initStore);

  const PersistentStoreProvider: React.FC = ({ children }) => {
    // Effects will only run on client side.
    useAsyncEffect(
      async (isMounted) => {
        const data = await getItem<any>(storageKey);
        if (data && isMounted()) {
          try {
            logging && console.log('Hydrating Store from Storage');
            applySnapshot(mstStore, merge(data, blacklist));
            logging && console.log('Successfully hydrated store from storage');
          } catch (error) {
            console.error(error);
            logging && console.log('Failed to hydrate store. Throwing away data from stogare.');
            await removeItem(storageKey);
          }
        }

        if (devtool) {
          try {
            logging && console.log('Dev env detected, trying to enable mobx-devtools-mst');
            const { default: makeInspectable } = await import('mobx-devtools-mst');
            makeInspectable(mstStore);
          } catch (error) {
            console.error(error);
          }
        }

        const saveSnapshot = debounce((snapshot) => {
          logging && console.log('Saving Snapshot to Storage');

          setItem(storageKey, snapshot);
        }, writeDelay);

        return onSnapshot(mstStore, (snapshot) => {
          logging && console.log('New Snapshot Available');
          saveSnapshot(snapshot);
        });
      },
      (disposer) => {
        logging && console.log('PersistentStoreProvider is getting unmounted.');
        // disposer can be undefined in some cases, such as-
        // Component getting unmounted before the async effect
        // has finished running, or, it has thrown.
        disposer?.();
      },
      []
    );

    return (
      <PersistentStoreContext.Provider value={mstStore}>{children}</PersistentStoreContext.Provider>
    );
  };

  const usePersistentStore = () => {
    const store = useContext(PersistentStoreContext);
    if (!store) {
      throw new Error('usePersistentStore must be used within a PersistentStoreProvider.');
    }
    return store;
  };

  return [PersistentStoreProvider, usePersistentStore] as const;
};

export default createPersistentStore;
