document.addEventListener('DOMContentLoaded', function () {

  // Glass nav hairline/shadow: only show once content has actually scrolled beneath it
  var siteHeader = document.querySelector('.site-header');
  if (siteHeader && !siteHeader.dataset.scrollWired) {
    siteHeader.dataset.scrollWired = '1';
    var updateHeaderScrolled = function () {
      siteHeader.classList.toggle('scrolled', window.scrollY > 8);
    };
    updateHeaderScrolled();
    window.addEventListener('scroll', updateHeaderScrolled, { passive: true });
  }

  // Mobile nav toggle (wired by config.js when present; guard prevents double-binding)
  var navToggle = document.getElementById('navToggle');
  var mainNav = document.getElementById('mainNav');
  if (navToggle && mainNav && !navToggle.dataset.navWired) {
    navToggle.dataset.navWired = '1';
    navToggle.addEventListener('click', function () {
      var isOpen = mainNav.classList.toggle('open');
      navToggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    });
    mainNav.querySelectorAll('a').forEach(function (link) {
      link.addEventListener('click', function () {
        mainNav.classList.remove('open');
        navToggle.setAttribute('aria-expanded', 'false');
      });
    });
  }

  // FAQ accordion (each faq-list/faq-page-list container manages its own open item)
  document.querySelectorAll('.faq-question').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var expanded = btn.getAttribute('aria-expanded') === 'true';
      var answer = btn.nextElementSibling;
      var container = btn.closest('.faq-list, .faq-page-list') || document;

      container.querySelectorAll('.faq-question').forEach(function (other) {
        if (other !== btn) {
          other.setAttribute('aria-expanded', 'false');
          other.nextElementSibling.style.maxHeight = null;
        }
      });

      btn.setAttribute('aria-expanded', expanded ? 'false' : 'true');
      answer.style.maxHeight = expanded ? null : answer.scrollHeight + 'px';
    });
  });

  // Pricing toggle (filters the "Get Your Team Trained Today" cards by course)
  var pricingToggle = document.querySelector('.pricing-toggle');
  var pricingGrid = document.getElementById('pricingGrid');
  if (pricingToggle && pricingGrid) {
    var pricingCards = pricingGrid.querySelectorAll('.pricing-card');
    var toggleButtons = pricingToggle.querySelectorAll('.pricing-toggle-btn');

    var selectCourse = function (course) {
      toggleButtons.forEach(function (btn) {
        var isActive = btn.dataset.course === course;
        btn.classList.toggle('active', isActive);
        btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
      });

      pricingCards.forEach(function (card) {
        card.classList.toggle('is-visible', card.dataset.course === course);
      });
    };

    toggleButtons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        selectCourse(btn.dataset.course);
      });
    });

    // Any "Enroll Now" link tagged with a course (course cards, hero, etc.)
    // pre-selects that course's pricing card before the page scrolls to #pricing.
    document.querySelectorAll('a[data-course]').forEach(function (link) {
      link.addEventListener('click', function () {
        selectCourse(link.dataset.course);
      });
    });
  }

  // Enroll forms (seat count, bulk pricing table, and per-course totals)
  document.querySelectorAll('.enroll-form').forEach(function (enrollForm) {
    var seatsInput = enrollForm.querySelector('input[type="number"]');
    var formTotal = enrollForm.querySelector('.form-total');
    var basePrice = parseFloat(enrollForm.dataset.pricePerSeat);

    var pricingCard = enrollForm.closest('.pricing-card');
    var priceOriginal = pricingCard ? pricingCard.querySelector('.price-original') : null;
    var priceAmount = pricingCard ? pricingCard.querySelector('.price-amount') : null;

    var bulkToggle = enrollForm.querySelector('.bulk-pricing-toggle');
    var bulkPanel = enrollForm.querySelector('.bulk-pricing-panel');
    var bulkTbody = enrollForm.querySelector('.bulk-pricing-table tbody');
    var bulkRows = [];

    if (bulkToggle && bulkPanel) {
      bulkToggle.addEventListener('click', function () {
        var expanded = bulkToggle.getAttribute('aria-expanded') === 'true';
        bulkToggle.setAttribute('aria-expanded', expanded ? 'false' : 'true');
        bulkPanel.hidden = expanded;
      });
    }

    if (bulkTbody) {
      BULK_TIERS.forEach(function (tier) {
        var tr = document.createElement('tr');
        tr.dataset.min = tier.min;
        tr.dataset.max = tier.max;

        var tdSeats = document.createElement('td');
        tdSeats.textContent = tierLabel(tier);
        var tdPrice = document.createElement('td');
        tdPrice.textContent = '$' + formatMoney(tierPrice(basePrice, tier));

        tr.appendChild(tdSeats);
        tr.appendChild(tdPrice);
        bulkTbody.appendChild(tr);
        bulkRows.push(tr);
      });
    }

    if (seatsInput && formTotal) {
      var updatePricing = function () {
        var seats = Math.max(1, parseInt(seatsInput.value, 10) || 1);
        var tier = tierForSeats(seats);
        var perSeat = tierPrice(basePrice, tier);

        formTotal.textContent = 'Total: $' + formatMoney(seats * perSeat);

        if (priceAmount) {
          priceAmount.textContent = '$' + formatMoney(perSeat);
        }
        if (priceOriginal) {
          priceOriginal.hidden = tier.discount === 0;
          priceOriginal.textContent = '$' + formatMoney(basePrice);
        }

        bulkRows.forEach(function (tr) {
          var trMin = parseInt(tr.dataset.min, 10);
          var trMax = parseInt(tr.dataset.max, 10);
          tr.classList.toggle('active-tier', seats >= trMin && seats <= trMax);
        });
      };
      seatsInput.addEventListener('input', updatePricing);
      updatePricing();
    }

    // Handle form submit -> Redirect to checkout page with selected course & seats
    enrollForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var seats = Math.max(1, parseInt(seatsInput ? seatsInput.value : '1', 10) || 1);
      var courseKey = pricingCard ? pricingCard.dataset.course : 'qsp';
      window.location.href = 'checkout.html?course=' + encodeURIComponent(courseKey) + '&seats=' + encodeURIComponent(seats);
    });
  });

});
