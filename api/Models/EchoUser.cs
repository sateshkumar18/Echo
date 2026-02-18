namespace Echo.Api.Models;

/// <summary>PRD: free, arcade_pass ($9/mo), echo_pro ($5/mo).</summary>
public class EchoUser
{
    public Guid Id { get; set; }
    public string DisplayName { get; set; } = "";
    public string Email { get; set; } = "";
    public string PasswordHash { get; set; } = "";
    /// <summary>free = 3 hr/month cap; arcade_pass / echo_pro = unlimited.</summary>
    public string SubscriptionTier { get; set; } = "free";
    public DateTime CreatedAt { get; set; }
}
