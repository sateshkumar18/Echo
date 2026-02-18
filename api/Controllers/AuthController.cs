using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using Echo.Api.Data;
using Echo.Api.Models;
using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.Mvc;
using Microsoft.IdentityModel.Tokens;

namespace Echo.Api.Controllers;

[ApiController]
[Route("auth")]
public class AuthController : ControllerBase
{
    private readonly EchoDbContext _db;
    private readonly IConfiguration _config;
    private readonly ILogger<AuthController> _logger;

    public AuthController(EchoDbContext db, IConfiguration config, ILogger<AuthController> logger)
    {
        _db = db;
        _config = config;
        _logger = logger;
    }

    [HttpPost("register")]
    public async Task<ActionResult<AuthResponse>> Register([FromBody] RegisterRequest req, CancellationToken ct)
    {
        var email = (req.Email ?? "").Trim().ToLowerInvariant();
        var displayName = (req.DisplayName ?? "").Trim();
        if (string.IsNullOrEmpty(email))
            return BadRequest(new { error = "Email is required." });
        if (string.IsNullOrEmpty(req.Password) || req.Password.Length < 6)
            return BadRequest(new { error = "Password must be at least 6 characters." });
        if (req.Password != req.ConfirmPassword)
            return BadRequest(new { error = "Password and confirm password do not match." });

        var existing = await _db.EchoUsers.FirstOrDefaultAsync(u => u.Email == email, ct);
        if (existing != null)
            return BadRequest(new { error = "Email already registered." });

        var user = new EchoUser
        {
            Id = Guid.NewGuid(),
            DisplayName = displayName.Length > 128 ? displayName[..128] : displayName,
            Email = email,
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(req.Password, workFactor: 12),
            CreatedAt = DateTime.UtcNow
        };
        _db.EchoUsers.Add(user);
        await _db.SaveChangesAsync(ct);
        _logger.LogInformation("User registered: {Email}", email);
        return Ok(GenerateAuthResponse(user));
    }

    [HttpPost("login")]
    public async Task<ActionResult<AuthResponse>> Login([FromBody] LoginRequest req, CancellationToken ct)
    {
        var email = (req.Email ?? "").Trim().ToLowerInvariant();
        if (string.IsNullOrEmpty(email) || string.IsNullOrEmpty(req.Password))
            return BadRequest(new { error = "Email and password are required." });

        var user = await _db.EchoUsers.FirstOrDefaultAsync(u => u.Email == email, ct);
        if (user == null)
            return Unauthorized(new { error = "Invalid email or password." });
        if (!BCrypt.Net.BCrypt.Verify(req.Password, user.PasswordHash))
            return Unauthorized(new { error = "Invalid email or password." });

        _logger.LogInformation("User logged in: {Email}", email);
        return Ok(GenerateAuthResponse(user));
    }

    private AuthResponse GenerateAuthResponse(EchoUser user)
    {
        var secret = _config["Auth:JwtSecret"] ?? Environment.GetEnvironmentVariable("JWT_SECRET");
        if (string.IsNullOrEmpty(secret))
            throw new InvalidOperationException("Auth:JwtSecret or JWT_SECRET must be set.");

        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(secret));
        var creds = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);
        var expires = DateTime.UtcNow.AddDays(7);
        var token = new JwtSecurityToken(
            issuer: _config["Auth:JwtIssuer"] ?? "Echo",
            audience: _config["Auth:JwtAudience"] ?? "Echo",
            claims: new[]
            {
                new Claim(ClaimTypes.NameIdentifier, user.Id.ToString()),
                new Claim(ClaimTypes.Email, user.Email)
            },
            expires: expires,
            signingCredentials: creds
        );
        var jwt = new JwtSecurityTokenHandler().WriteToken(token);
        return new AuthResponse
        {
            Token = jwt,
            ExpiresAt = expires,
            User = new AuthUserDto { Id = user.Id, DisplayName = user.DisplayName, Email = user.Email, SubscriptionTier = user.SubscriptionTier ?? "free" }
        };
    }
}

public class RegisterRequest
{
    public string DisplayName { get; set; } = "";
    public string Email { get; set; } = "";
    public string Password { get; set; } = "";
    public string ConfirmPassword { get; set; } = "";
}

public class LoginRequest
{
    public string Email { get; set; } = "";
    public string Password { get; set; } = "";
}

public class AuthResponse
{
    public string Token { get; set; } = "";
    public DateTime ExpiresAt { get; set; }
    public AuthUserDto User { get; set; } = new();
}

public class AuthUserDto
{
    public Guid Id { get; set; }
    public string DisplayName { get; set; } = "";
    public string Email { get; set; } = "";
    /// <summary>free, arcade_pass, echo_pro</summary>
    public string SubscriptionTier { get; set; } = "free";
}
