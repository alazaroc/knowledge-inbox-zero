import LibraryPage from './LibraryPage';

// Dedicated "To read" view: the user's starred picks, their own reading queue.
// It reuses the whole Library (same rows, actions, filters) in to-read mode,
// which starts filtered to starred documents.
export default function ToReadPage() {
  return <LibraryPage mode="to-read" />;
}
