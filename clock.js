console.log("DateTimeElement script loaded");

class DateTimeElement extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.container = document.createElement("div");
    this.container.style.fontFamily = "monospace";
    this.container.style.fontSize = "1.2em";
    this.container.style.padding = "8px";
    this.shadowRoot.appendChild(this.container);
  }

  connectedCallback() {
    this.updateTime();
    this.timer = setInterval(() => this.updateTime(), 1000);
  }

  disconnectedCallback() {
    clearInterval(this.timer);
  }

  updateTime() {
    const now = new Date();
    const formatted = now.toLocaleString(); // local date + time
    this.container.textContent = formatted;
  }
}

customElements.define("date-time", DateTimeElement);
