import r2wc from '@r2wc/react-to-web-component';
import App from './App';

const SignatureWidget = r2wc(App, {
  props: { interactionId: 'String' }
});
customElements.define('wxcc-signature-widget', SignatureWidget);
