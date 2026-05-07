import r2wc from '@r2wc/react-to-web-component';
import App from './App';

const BaseSignatureWidget = r2wc(App, {
  props: { interactionId: 'String' }
});

const propsSymbol = Symbol.for('r2wc.props');
const renderSymbol = Symbol.for('r2wc.render');

class SignatureWidget extends BaseSignatureWidget {
  static get observedAttributes() {
    return BaseSignatureWidget.observedAttributes || [];
  }

  get interactionId() {
    return super.interactionId;
  }

  set interactionId(value) {
    super.interactionId = value;

    if (value == null && this[propsSymbol]) {
      this[propsSymbol].interactionId = null;
      this[renderSymbol]?.();
    }
  }

  attributeChangedCallback(name, oldValue, newValue) {
    super.attributeChangedCallback?.(name, oldValue, newValue);

    if (name === 'interaction-id' && oldValue != null && newValue == null && this[propsSymbol]) {
      this[propsSymbol].interactionId = null;
      this[renderSymbol]?.();
    }
  }
}

customElements.define('wxcc-signature-widget', SignatureWidget);
