(function () {
   // Enable strict mode for error handling.
   'use strict';

   // Define a custom HTML element as a subclass of HTMLElement.
   class VanillaCounter extends HTMLElement {
      // Constructor function to initialize the element.
      constructor() {
         super(); // Call the constructor of the superclass (HTMLElement).

         // Initialize instance variables.
         this.friendlyURLMapping = this.getAttribute('friendly-url-mapping');
         this.value = 0;

         // Create DOM elements for counter, buttons, and route.
         this.counter = document.createElement('span');
         this.counter.setAttribute('class', 'counter');
         this.counter.innerText = this.value;

         this.decrementButton = document.createElement('button');
         this.decrementButton.setAttribute('class', 'decrement');
         this.decrementButton.innerText = '-';

         this.incrementButton = document.createElement('button');
         this.incrementButton.setAttribute('class', 'increment');
         this.incrementButton.innerText = '+';

         // Create a <style> element to apply CSS styles.
         const style = document.createElement('style');
         style.innerHTML = `
            button {
               height: 24px;
               width: 24px;
            }

            span {
               display: inline-block;
               font-style: italic;
               margin: 0 1em;
            }
         `;

         // Create a <div> element to display portlet route information
         this.route = document.createElement('div');
         this.updateRoute();

         // Create a root <div> element to hold all elements.
         const root = document.createElement('div');
         root.setAttribute('class', 'portlet-container');
         root.appendChild(style);
         root.appendChild(this.decrementButton);
         root.appendChild(this.incrementButton);
         root.appendChild(this.counter);
         root.appendChild(this.route);

         // Attach the shadow DOM to the custom element.
         this.attachShadow({mode: 'open'}).appendChild(root);

         // Bind event handlers to the current instance.
         this.decrement = this.decrement.bind(this);
         this.increment = this.increment.bind(this);
      }

      // Called when the custom element is added to the DOM.
      connectedCallback() {
         console.log("VanillaCounter connected");
         this.innerHTML = "<b>Counter initialized</b>";
         this.decrementButton.addEventListener('click', this.decrement);
         this.incrementButton.addEventListener('click', this.increment);
      }

      // Handles the decrement button click event.
      decrement() {
         this.counter.innerText = --this.value;
      }

      // Called when the custom element is removed from the DOM.
      disconnectedCallback() {
         this.decrementButton.removeEventListener('click', this.decrement);
         this.incrementButton.removeEventListener('click', this.increment);
      }

      // Handles the increment button click event.
      increment() {
         this.counter.innerText = ++this.value;
      }

      // Method to update the portlet route information based on the current URL
      updateRoute() {
         const url = window.location.href;
         const prefix = `/-/${this.friendlyURLMapping}/`;
         const prefixIndex = url.indexOf(prefix);
         let route;

         if (prefixIndex === -1) {
            route = '/';
         } else {
            route = url.substring(prefixIndex + prefix.length - 1);
         }

         this.route.innerHTML = `<hr><b>Portlet internal route</b>: ${route}`;
      }
   }

   // Check if the custom element has already been defined
   if (!customElements.get('vanilla-counter')) {
      // Define the custom element with the tag name 'vanilla-counter'
      customElements.define('vanilla-counter', VanillaCounter);
   }
})();
