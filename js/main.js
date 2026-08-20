document.addEventListener('DOMContentLoaded', function () {

  // Mobile nav toggle
  var navToggle = document.getElementById('navToggle');
  var mainNav = document.getElementById('mainNav');
  if (navToggle && mainNav) {
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

  // Bulk pricing tiers (seat-count discount ladder, applied to each course's per-seat price)
  var BULK_TIERS = [
    { min: 1, max: 1, discount: 0 },
    { min: 2, max: 10, discount: 0.01 },
    { min: 11, max: 20, discount: 0.02 },
    { min: 21, max: 50, discount: 0.03 },
    { min: 51, max: 100, discount: 0.05 },
    { min: 101, max: 250, discount: 0.07 },
    { min: 251, max: 500, discount: 0.08 },
    { min: 501, max: 1000, discount: 0.10 }
  ];

  var formatMoney = function (n) {
    return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  var tierForSeats = function (seats) {
    for (var i = BULK_TIERS.length - 1; i >= 0; i--) {
      if (seats >= BULK_TIERS[i].min) return BULK_TIERS[i];
    }
    return BULK_TIERS[0];
  };

  var tierLabel = function (tier) {
    return tier.min === tier.max ? String(tier.min) : tier.min + '–' + tier.max.toLocaleString('en-US');
  };

  var tierPrice = function (basePrice, tier) {
    return Math.round(basePrice * (1 - tier.discount) * 100) / 100;
  };

  // Enroll forms (seat count, bulk pricing table, and per-course totals)
  document.querySelectorAll('.enroll-form').forEach(function (enrollForm) {
    var seatsInput = enrollForm.querySelector('input[type="number"]');
    var formTotal = enrollForm.querySelector('.form-total');
    var formSuccess = document.getElementById(enrollForm.dataset.successTarget);
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

    if (formSuccess) {
      enrollForm.addEventListener('submit', function (e) {
        e.preventDefault();
        enrollForm.hidden = true;
        formSuccess.hidden = false;
        formSuccess.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    }
  });

});
