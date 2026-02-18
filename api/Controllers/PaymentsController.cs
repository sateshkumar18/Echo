using System.Security.Claims;
using Echo.Api.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Stripe;
using Stripe.Checkout;

namespace Echo.Api.Controllers;

/// <summary>Stripe Checkout: create session and return URL. Payments are handled by API only (see docs/PAYMENTS.md).</summary>
[ApiController]
[Route("payments")]
[Authorize]
public class PaymentsController : ControllerBase
{
    private readonly EchoDbContext _db;
    private readonly IConfiguration _config;
    private readonly ILogger<PaymentsController> _logger;

    public PaymentsController(EchoDbContext db, IConfiguration config, ILogger<PaymentsController> logger)
    {
        _db = db;
        _config = config;
        _logger = logger;
    }

    /// <summary>Create a Stripe Checkout Session for the chosen tier. Returns the URL to redirect the user to.</summary>
    [HttpPost("create-checkout-session")]
    public async Task<ActionResult<CreateCheckoutSessionResponse>> CreateCheckoutSession(
        [FromBody] CreateCheckoutSessionRequest request,
        CancellationToken ct)
    {
        var tier = (request.Tier ?? "").Trim().ToLowerInvariant();
        if (tier != "arcade_pass" && tier != "echo_pro")
            return BadRequest(new { error = "Tier must be 'arcade_pass' or 'echo_pro'." });

        var userIdClaim = User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub");
        if (string.IsNullOrEmpty(userIdClaim) || !Guid.TryParse(userIdClaim, out var userId))
            return Unauthorized();

        var user = await _db.EchoUsers.FindAsync([userId], ct);
        if (user == null)
            return Unauthorized();

        var secretKey = _config["Stripe:SecretKey"] ?? Environment.GetEnvironmentVariable("STRIPE_SECRET_KEY");
        if (string.IsNullOrEmpty(secretKey))
            return StatusCode(500, new { error = "Stripe is not configured (Stripe:SecretKey or STRIPE_SECRET_KEY)." });

        var priceIdKey = tier == "arcade_pass" ? "Stripe:ArcadePassPriceId" : "Stripe:EchoProPriceId";
        var priceId = _config[priceIdKey] ?? Environment.GetEnvironmentVariable(
            tier == "arcade_pass" ? "STRIPE_ARCADE_PASS_PRICE_ID" : "STRIPE_ECHO_PRO_PRICE_ID");
        if (string.IsNullOrEmpty(priceId))
            return StatusCode(500, new { error = $"Stripe price not configured ({priceIdKey}). Create a product in Stripe Dashboard and set the price ID." });

        StripeConfiguration.ApiKey = secretKey;

        var baseUrl = _config["Stripe:BaseUrl"] ?? $"{Request.Scheme}://{Request.Host}";
        var successUrl = _config["Stripe:SuccessUrl"]?.Trim();
        if (string.IsNullOrEmpty(successUrl)) successUrl = $"{baseUrl}/payments/success?session_id={{CHECKOUT_SESSION_ID}}";
        var cancelUrl = _config["Stripe:CancelUrl"]?.Trim();
        if (string.IsNullOrEmpty(cancelUrl)) cancelUrl = $"{baseUrl}/payments/cancel";

        var options = new SessionCreateOptions
        {
            Mode = "subscription",
            CustomerEmail = user.Email,
            ClientReferenceId = user.Id.ToString(),
            Metadata = new Dictionary<string, string> { ["tier"] = tier, ["user_id"] = user.Id.ToString() },
            SubscriptionData = new SessionSubscriptionDataOptions
            {
                Metadata = new Dictionary<string, string> { ["user_id"] = user.Id.ToString() }
            },
            SuccessUrl = successUrl,
            CancelUrl = cancelUrl,
            LineItems = new List<SessionLineItemOptions>
            {
                new() { Price = priceId, Quantity = 1 }
            }
        };

        var service = new SessionService();
        var session = await service.CreateAsync(options, cancellationToken: ct);

        _logger.LogInformation("Checkout session created for user {UserId}, tier {Tier}, session {SessionId}", user.Id, tier, session.Id);
        return Ok(new CreateCheckoutSessionResponse { Url = session.Url });
    }

    /// <summary>Stripe redirects here after successful payment. User can close the tab and refresh the extension.</summary>
    [HttpGet("success")]
    [AllowAnonymous]
    public IActionResult Success([FromQuery] string? session_id)
    {
        var html = @"<!DOCTYPE html><html><head><meta charset=""utf-8""/><title>Payment successful</title></head><body style=""font-family:system-ui;padding:2rem;text-align:center;""><h1>Payment successful</h1><p>You can close this tab. Open the Echo extension and log in again (or refresh) to see your new plan.</p></body></html>";
        return Content(html, "text/html");
    }

    /// <summary>Stripe redirects here if the user cancels checkout.</summary>
    [HttpGet("cancel")]
    [AllowAnonymous]
    public IActionResult Cancel()
    {
        var html = @"<!DOCTYPE html><html><head><meta charset=""utf-8""/><title>Checkout cancelled</title></head><body style=""font-family:system-ui;padding:2rem;text-align:center;""><h1>Checkout cancelled</h1><p>You can close this tab.</p></body></html>";
        return Content(html, "text/html");
    }
}

public class CreateCheckoutSessionRequest
{
    /// <summary>arcade_pass ($9/mo) or echo_pro ($5/mo)</summary>
    public string Tier { get; set; } = "";
}

public class CreateCheckoutSessionResponse
{
    public string Url { get; set; } = "";
}
