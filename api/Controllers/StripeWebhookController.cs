using System.Text;
using Echo.Api.Data;
using Microsoft.AspNetCore.Mvc;
using Stripe;
using Stripe.Checkout;

namespace Echo.Api.Controllers;

/// <summary>Stripe webhook: receives payment events and updates subscription_tier. Must read raw body for signature verification.</summary>
[ApiController]
[Route("webhooks")]
public class StripeWebhookController : ControllerBase
{
    private readonly EchoDbContext _db;
    private readonly IConfiguration _config;
    private readonly ILogger<StripeWebhookController> _logger;

    public StripeWebhookController(EchoDbContext db, IConfiguration config, ILogger<StripeWebhookController> logger)
    {
        _db = db;
        _config = config;
        _logger = logger;
    }

    /// <summary>Stripe sends POST here. Verifies signature and updates user tier on checkout.session.completed.</summary>
    [HttpPost("stripe")]
    [Consumes("application/json")]
    public async Task<IActionResult> StripeWebhook(CancellationToken ct)
    {
        var webhookSecret = _config["Stripe:WebhookSecret"] ?? Environment.GetEnvironmentVariable("STRIPE_WEBHOOK_SECRET");
        if (string.IsNullOrEmpty(webhookSecret))
        {
            _logger.LogWarning("Stripe webhook secret not configured.");
            return StatusCode(500);
        }

        Request.EnableBuffering();
        string json;
        using (var reader = new StreamReader(Request.Body, Encoding.UTF8, leaveOpen: true))
            json = await reader.ReadToEndAsync(ct);
        Request.Body.Position = 0;

        var signature = Request.Headers["Stripe-Signature"].FirstOrDefault();
        if (string.IsNullOrEmpty(signature))
        {
            _logger.LogWarning("Stripe webhook missing signature.");
            return BadRequest();
        }

        Event stripeEvent;
        try
        {
            stripeEvent = EventUtility.ConstructEvent(json, signature, webhookSecret);
        }
        catch (StripeException ex)
        {
            _logger.LogWarning(ex, "Stripe webhook signature verification failed.");
            return BadRequest();
        }

        if (stripeEvent.Type == Events.CheckoutSessionCompleted)
        {
            var session = stripeEvent.Data.Object as Stripe.Checkout.Session;
            if (session?.Metadata != null && session.Metadata.TryGetValue("user_id", out var userIdStr) && session.Metadata.TryGetValue("tier", out var tier))
            {
                if (Guid.TryParse(userIdStr, out var userId) && (tier == "arcade_pass" || tier == "echo_pro"))
                {
                    var user = await _db.EchoUsers.FindAsync(new object[] { userId }, ct);
                    if (user != null)
                    {
                        user.SubscriptionTier = tier;
                        await _db.SaveChangesAsync(ct);
                        _logger.LogInformation("Updated user {UserId} to tier {Tier} after Stripe checkout.", userId, tier);
                    }
                }
            }
        }
        else if (stripeEvent.Type == Events.CustomerSubscriptionDeleted)
        {
            var subscription = stripeEvent.Data.Object as Stripe.Subscription;
            if (subscription?.Metadata != null && subscription.Metadata.TryGetValue("user_id", out var userIdStr))
            {
                if (Guid.TryParse(userIdStr, out var userId))
                {
                    var user = await _db.EchoUsers.FindAsync(new object[] { userId }, ct);
                    if (user != null)
                    {
                        user.SubscriptionTier = "free";
                        await _db.SaveChangesAsync(ct);
                        _logger.LogInformation("Reverted user {UserId} to free after subscription deleted.", userId);
                    }
                }
            }
        }

        return Ok();
    }
}
