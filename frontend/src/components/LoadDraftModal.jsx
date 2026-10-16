import Modal from './Modal.jsx';
import { resourceShort } from '../constants.js';
import { formatDateTime } from '../utils/format.js';

export default function LoadDraftModal({ drafts, onLoad, onClose }) {
  return (
    <Modal title="Load Draft" onClose={onClose} size="md">
      {drafts.length === 0 ? (
        <p className="muted">You have no saved drafts. Use “Save Draft” in the request form to keep one for later.</p>
      ) : (
        <ul className="draft-list">
          {drafts.map((d) => (
            <li key={d.id}>
              <button type="button" onClick={() => onLoad(d)}>
                <span className="draft-title">{d.data.purpose || 'Untitled request'}</span>
                <span className="draft-meta">
                  {d.data.resource_type ? resourceShort(d.data.resource_type) : 'No resource selected'}
                </span>
                <span className="draft-time">
                  <small>Last modified</small>
                  {formatDateTime(d.updated_at)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
