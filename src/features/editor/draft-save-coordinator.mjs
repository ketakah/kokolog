export function createDraftSaveCoordinator(persist) {
  let editGeneration = 0;
  let persistedGeneration = 0;
  let writeTail = Promise.resolve();

  return {
    markEdited() {
      editGeneration += 1;
      return editGeneration;
    },

    hasUnsavedChanges() {
      return editGeneration > persistedGeneration;
    },

    async save(snapshot) {
      if (editGeneration <= persistedGeneration) {
        await writeTail;
        return {
          saved: false,
          hasUnsavedChanges: editGeneration > persistedGeneration,
        };
      }

      const generation = editGeneration;
      const write = writeTail
        .then(() => persist(snapshot))
        .then(() => {
          persistedGeneration = Math.max(persistedGeneration, generation);
          return {
            saved: true,
            generation,
            hasUnsavedChanges: editGeneration > persistedGeneration,
          };
        });
      writeTail = write.catch(() => {});
      return write;
    },

    async drain() {
      await writeTail;
    },

    markPersisted() {
      persistedGeneration = editGeneration;
    },
  };
}
