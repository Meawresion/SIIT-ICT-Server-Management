import Modal from './Modal.jsx';
import { CheckIcon } from './Icons.jsx';
import { formatId } from '../utils/format.js';

export default function SubmittedModal({ request, onClose }) {
  return (
    <Modal onClose={onClose} size="sm">
      <div className="submitted">
        <h2>Submitted!</h2>
        <div className="submitted-check"><CheckIcon width={44} height={44} strokeWidth={2.5} /></div>
        <p>
          Request <strong>{formatId(request.id)}</strong> is waiting for an approver.
          You can follow its status from your home page.
        </p>
        <button type="button" className="btn btn-primary" onClick={onClose} autoFocus>OK</button>
      </div>
    </Modal>
  );
}
